import {
  createWarehouseSettingsStore,
  createChzSessionStore,
} from '@avito/database';
import { createWarehouseSettings } from '@avito/domain';
import { createTrueApiClient } from '../infrastructure/true-api.js';
import { assertCurrentShipment } from '@avito/domain';
import { readAvitoShipmentReference } from '@avito/database';
import { createAvitoOrderActions } from '@avito/domain';
import { createAvitoActionStore } from '@avito/database';
import { createAvitoActionProvider } from '../infrastructure/avito-actions.js';
import { createSignerEnrollmentStore } from '@avito/database';
import { createSignerEnrollment } from '@avito/domain';
import {
  inspectSignerCertificate,
  buildSignerInstaller,
} from '../infrastructure/signer-installation.js';
import { prepareAvitoImport } from '@avito/database';
import { requirePipeline } from '@avito/domain';
import { createLocalSigningStore } from '@avito/database';
import { createLocalSignerService } from '@avito/domain';
import { createMarkingPipelineStore } from '@avito/database';
import { createMarkingPipeline } from '@avito/domain';
import { createDatabaseClient, createInventoryStore } from '@avito/database';
import {
  createMarkingProtector,
  createMarkingUnprotector,
} from '../infrastructure/marking-protection.js';
import { createAvitoReadLimiter } from '../infrastructure/avito-read-limiter.js';
import { createAvitoOrderReader } from '../infrastructure/avito-orders.js';
import { createNationalCatalogLookup } from '../infrastructure/national-catalog.js';
import { createRedisConnection } from '@avito/queue';
import type { AppConfig } from '../config/index.js';
import {
  createVerifyTelegramSession,
  createReadInventory,
  createReadOrders,
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
  const orderReader = createAvitoOrderReader({
    includePhotos: false,
    clientId: config.AVITO_API_CLIENT_ID,
    clientSecret: config.AVITO_API_CLIENT_SECRET,
    acquireReadSlot: createAvitoReadLimiter(
      redis,
      config.AVITO_API_CLIENT_ID ?? 'unconfigured',
    ),
  });

  const registry = createSignerEnrollmentStore(database.db);
  const enrollment =
    config.SIGNER_TELEGRAM_ENROLLMENT_ENABLED && config.PUBLIC_API_URL
      ? createSignerEnrollment({
          store: registry,
          publicUrl: config.PUBLIC_API_URL,
          inspectCertificate: inspectSignerCertificate,
        })
      : undefined;
  const protection = config.MARKING_ENCRYPTION_KEY
    ? {
        encrypt: createMarkingProtector(
          config.MARKING_ENCRYPTION_KEY,
          config.MARKING_ENCRYPTION_KEY_ID,
        ),
        decrypt: createMarkingUnprotector(
          config.MARKING_ENCRYPTION_KEY,
          config.MARKING_ENCRYPTION_KEY_ID,
        ),
      }
    : undefined;
  const placesClient = createTrueApiClient({
    session: createChzSessionStore(database.db, protection),
  });
  const bot =
    config.TELEGRAM_MODE !== 'disabled' &&
    config.TELEGRAM_BOT_TOKEN &&
    config.MINI_APP_URL
      ? createTelegramBot(
          config.TELEGRAM_BOT_TOKEN,
          config.MINI_APP_URL,
          enrollment
            ? { enrollment, findUser: users.findActiveUser }
            : undefined,
        )
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
    ...(enrollment
      ? {
          signerEnrollment: enrollment,
          signerInstaller: buildSignerInstaller,
          authenticateSigner: async (token: string) => {
            const binding = await enrollment.authorize(token);
            return binding
              ? {
                  binding,
                  service: createLocalSignerService(
                    createLocalSigningStore(
                      database.db,
                      protection,
                      binding.certificateThumbprint,
                      binding.sellerInn,
                    ),
                  ),
                }
              : null;
          },
        }
      : {}),
    ...(!config.SIGNER_TELEGRAM_ENROLLMENT_ENABLED && config.LOCAL_SIGNER_TOKEN
      ? { localSignerToken: config.LOCAL_SIGNER_TOKEN }
      : {}),
    localSigner: createLocalSignerService(
      createLocalSigningStore(
        database.db,
        config.MARKING_ENCRYPTION_KEY
          ? {
              encrypt: createMarkingProtector(
                config.MARKING_ENCRYPTION_KEY,
                config.MARKING_ENCRYPTION_KEY_ID,
              ),
              decrypt: createMarkingUnprotector(
                config.MARKING_ENCRYPTION_KEY,
                config.MARKING_ENCRYPTION_KEY_ID,
              ),
            }
          : undefined,
        config.LOCAL_SIGNER_CERTIFICATE_THUMBPRINT,
      ),
    ),

    warehouseSettings: createWarehouseSettings({
      store: createWarehouseSettingsStore(database.db),
      places: (inn) => placesClient.places(inn),
    }),
    markingPipeline: createMarkingPipeline(
      createMarkingPipelineStore(
        database.db,
        config.MARKING_ENCRYPTION_KEY
          ? {
              encrypt: createMarkingProtector(
                config.MARKING_ENCRYPTION_KEY,
                config.MARKING_ENCRYPTION_KEY_ID,
              ),
              decrypt: createMarkingUnprotector(
                config.MARKING_ENCRYPTION_KEY,
                config.MARKING_ENCRYPTION_KEY_ID,
              ),
            }
          : undefined,
        {
          avitoConfigured: !!(
            config.AVITO_API_CLIENT_ID && config.AVITO_API_CLIENT_SECRET
          ),
          signerConfigured:
            !config.SIGNER_TELEGRAM_ENROLLMENT_ENABLED &&
            !!(
              config.LOCAL_SIGNER_TOKEN &&
              config.LOCAL_SIGNER_CERTIFICATE_THUMBPRINT
            ),
          documentsEnabled: config.CHZ_DOCUMENT_SUBMISSION_ENABLED,
          avitoWritesEnabled: config.AVITO_WRITES_ENABLED,
        },
      ),
      {
        validateShipment: async (action, input) => {
          const ref = await readAvitoShipmentReference(
            database.db,
            String(input.shipmentId),
            config.AVITO_API_CLIENT_ID ?? '',
          );
          const current = await orderReader.get(ref.externalOrderId);
          requirePipeline(current.ok, current.ok ? '' : current.code);
          assertCurrentShipment(
            current.order,
            ref,
            action === 'pack' ? 'pack' : 'dispatch',
          );
        },
        importOrder: async (input) => {
          const result = await orderReader.get(String(input.externalOrderId));
          requirePipeline(result.ok, result.ok ? '' : result.code);
          return prepareAvitoImport(
            database.db,
            result.order,
            input,
            config.AVITO_API_CLIENT_ID ?? '',
          );
        },
      },
    ),
    avitoOrderActions: createAvitoOrderActions({
      store: createAvitoActionStore(
        database.db,
        protection,
        config.AVITO_API_CLIENT_ID ?? '',
      ),
      reader: orderReader,
      writesEnabled: config.AVITO_WRITES_ENABLED,
      provider: createAvitoActionProvider({
        clientId: config.AVITO_API_CLIENT_ID,
        clientSecret: config.AVITO_API_CLIENT_SECRET,
        writesEnabled: config.AVITO_WRITES_ENABLED,
        acquireSlot: createAvitoReadLimiter(
          redis,
          config.AVITO_API_CLIENT_ID ?? 'unconfigured',
        ),
      }),
    }),
    readOrders: createReadOrders(
      createAvitoOrderReader({
        clientId: config.AVITO_API_CLIENT_ID,
        clientSecret: config.AVITO_API_CLIENT_SECRET,
        acquireReadSlot: createAvitoReadLimiter(
          redis,
          config.AVITO_API_CLIENT_ID ?? 'unconfigured',
        ),
      }),
    ),
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
          .launch({ allowedUpdates: ['message', 'callback_query'] }, () => {
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
