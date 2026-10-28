import { createDatabaseClient, createInventoryStore } from '@avito/database';
import { createMarkingProtector } from '../infrastructure/marking-protection.js';
import { createNationalCatalogLookup } from '../infrastructure/national-catalog.js';
import { createRedisConnection } from '@avito/queue';
import type { AppConfig } from '../config/index.js';
import {
  createVerifyTelegramSession,
  createReadInventory,
  createReceiveStock,
} from '@avito/domain';
import { createUserAccessStore } from '../infrastructure/persistence.js';
import { createTelegramIdentityVerifier } from '../infrastructure/telegram-auth.js';
import { createReadinessCheck } from '../infrastructure/readiness.js';
import { createTelegramUpdateDelivery } from '../infrastructure/telegram-updates.js';
import { buildApp } from '../http/app.js';
import { createTelegramBot } from '../telegram/index.js';

export async function createApiRuntime(config: AppConfig) {
  const database = createDatabaseClient(config.DATABASE_URL);
  const redis = createRedisConnection(config.REDIS_URL);
  const users = createUserAccessStore(database);
  const inventory = createInventoryStore(database.db);
  const bot =
    config.TELEGRAM_MODE !== 'disabled' &&
    config.TELEGRAM_BOT_TOKEN &&
    config.MINI_APP_URL
      ? createTelegramBot(config.TELEGRAM_BOT_TOKEN, config.MINI_APP_URL)
      : undefined;
  const deliverTelegramUpdate =
    config.TELEGRAM_MODE === 'webhook' && bot
      ? createTelegramUpdateDelivery({
          redis,
          botId: String(bot.telegram.token.split(':')[0]),
          handleUpdate: (update) =>
            bot.handleUpdate(
              update as unknown as Parameters<typeof bot.handleUpdate>[0],
            ),
        })
      : undefined;
  const app = await buildApp(config, {
    readInventory: createReadInventory(inventory),
    receiveStock: createReceiveStock({
      receive: (command) => inventory.receive(command),
      needsCatalogLookup: (gtin) => inventory.needsCatalogLookup(gtin),
      lookupCatalog: createNationalCatalogLookup({
        ...(config.CHZ_NATIONAL_CATALOG_API_KEY
          ? { apiKey: config.CHZ_NATIONAL_CATALOG_API_KEY }
          : {}),
        environment: config.CHZ_NATIONAL_CATALOG_ENVIRONMENT,
        timeoutMs: config.CHZ_NATIONAL_CATALOG_TIMEOUT_MS,
      }),
      ...(config.MARKING_ENCRYPTION_KEY
        ? {
            protectMarking: createMarkingProtector(
              config.MARKING_ENCRYPTION_KEY,
              config.MARKING_ENCRYPTION_KEY_ID,
            ),
          }
        : {}),
    }),
    verifyTelegramSession: createVerifyTelegramSession({
      verifyIdentity: createTelegramIdentityVerifier(
        config.TELEGRAM_BOT_TOKEN,
        config.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
      ),
      findActiveUser: users.findActiveUser,
    }),
    checkReadiness: createReadinessCheck(database, redis),
    ...(deliverTelegramUpdate ? { deliverTelegramUpdate } : {}),
  });
  let pollingStarted = false;
  let closing: Promise<void> | undefined;
  return {
    app,
    async start(onPollingFailure: () => void) {
      await app.listen({ host: config.HOST, port: config.PORT });
      if (config.TELEGRAM_MODE !== 'polling' || !bot) return;
      try {
        if ((await bot.telegram.getWebhookInfo()).url)
          throw new Error('Remove webhook before using polling');
        void bot
          .launch({ allowedUpdates: ['message'] }, () => {
            pollingStarted = true;
            app.log.info('Telegram polling started');
          })
          .catch(onPollingFailure);
      } catch {
        onPollingFailure();
      }
    },
    close() {
      closing ??= (async () => {
        if (pollingStarted) bot?.stop('shutdown');
        await app.close();
        await Promise.all([database.pool.end(), redis.quit()]);
      })();
      return closing;
    },
  };
}
