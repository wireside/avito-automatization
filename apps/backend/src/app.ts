import { timingSafeEqual } from 'node:crypto';

import cors from '@fastify/cors';
import { telegramAuthRequestSchema } from '@avito/contracts';
import type { DatabaseClient } from '@avito/database';
import { findActiveUserWithRoles } from '@avito/database';
import {
  TelegramInitDataError,
  validateTelegramInitData,
} from '@avito/integrations';
import { createLogger } from '@avito/observability';
import type { ReturnTypeOfCreateRedisConnection } from './types.js';
import Fastify from 'fastify';
import { Telegraf } from 'telegraf';

import type { AppConfig } from './config.js';

export interface AppDependencies {
  config: AppConfig;
  database: DatabaseClient;
  redis: ReturnTypeOfCreateRedisConnection;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export async function buildApp({ config, database, redis }: AppDependencies) {
  const logger = createLogger(config.LOG_LEVEL);
  const app = Fastify({ loggerInstance: logger });

  await app.register(cors, {
    origin: config.MINI_APP_ORIGIN,
    credentials: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', request.id);
  });

  app.get('/health/live', () => ({
    status: 'ok' as const,
    service: 'backend-api',
    timestamp: new Date().toISOString(),
  }));

  app.get('/health/ready', async (_request, reply) => {
    const checks = await Promise.allSettled([
      database.pool.query('select 1'),
      redis.ping(),
    ]);
    const ready = checks.every((check) => check.status === 'fulfilled');
    if (!ready) reply.code(503);
    return {
      status: ready ? ('ok' as const) : ('degraded' as const),
      service: 'backend-api',
      timestamp: new Date().toISOString(),
      dependencies: {
        postgres: checks[0]?.status === 'fulfilled' ? 'ok' : 'error',
        redis: checks[1]?.status === 'fulfilled' ? 'ok' : 'error',
      },
    };
  });

  app.post('/api/v1/auth/telegram/verify', async (request, reply) => {
    if (!config.TELEGRAM_BOT_TOKEN) {
      return reply.code(503).send({ code: 'TELEGRAM_NOT_CONFIGURED' });
    }
    const parsed = telegramAuthRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'INVALID_REQUEST' });
    }

    try {
      const validated = validateTelegramInitData(
        parsed.data.initData,
        config.TELEGRAM_BOT_TOKEN,
        { maxAgeSeconds: config.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS },
      );
      if (!validated.user) {
        return reply.code(401).send({ code: 'TELEGRAM_USER_MISSING' });
      }
      const user = await findActiveUserWithRoles(
        database.db,
        String(validated.user.id),
      );
      if (!user) return reply.code(403).send({ code: 'USER_NOT_ALLOWED' });
      return { user };
    } catch (error) {
      if (error instanceof TelegramInitDataError) {
        return reply.code(401).send({ code: error.code });
      }
      throw error;
    }
  });

  if (config.TELEGRAM_BOT_TOKEN) {
    const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
    bot.start(async (context) => {
      await context.reply('Откройте Mini App для работы с заказами и складом.');
    });

    app.post('/webhooks/telegram', async (request, reply) => {
      if (
        !config.TELEGRAM_WEBHOOK_SECRET ||
        typeof request.headers['x-telegram-bot-api-secret-token'] !==
          'string' ||
        !secureEqual(
          request.headers['x-telegram-bot-api-secret-token'],
          config.TELEGRAM_WEBHOOK_SECRET,
        )
      ) {
        return reply.code(401).send({ code: 'INVALID_WEBHOOK_SECRET' });
      }
      await bot.handleUpdate(
        request.body as Parameters<typeof bot.handleUpdate>[0],
      );
      return reply.code(204).send();
    });
  } else {
    app.post('/webhooks/telegram', async (_request, reply) =>
      reply.code(503).send({ code: 'TELEGRAM_NOT_CONFIGURED' }),
    );
  }

  return app;
}
