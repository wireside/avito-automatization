import cors from '@fastify/cors';
import { createLogger } from '@avito/observability';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/index.js';
import type { SessionResult, ReadInventory, ReceiveStock } from '@avito/domain';
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerOpenApiRoute } from './routes/openapi.js';
import { registerHttpErrors } from './errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import {
  registerHealthRoutes,
  type DependencyReadiness,
} from './routes/health.js';
import {
  registerTelegramWebhook,
  type DeliverTelegramUpdate,
} from './routes/telegram-webhook.js';

export interface HttpServices {
  verifyTelegramSession: (initData: string) => Promise<SessionResult>;
  checkReadiness: () => Promise<DependencyReadiness>;
  deliverTelegramUpdate?: DeliverTelegramUpdate;
  receiveStock?: ReceiveStock;
  readInventory?: ReadInventory;
}
export async function buildApp(
  config: Pick<
    AppConfig,
    'LOG_LEVEL' | 'MINI_APP_ORIGIN' | 'TELEGRAM_WEBHOOK_SECRET'
  >,
  services: HttpServices,
) {
  const logger: FastifyBaseLogger = createLogger(config.LOG_LEVEL);
  const app = Fastify({ loggerInstance: logger });
  await app.register(cors, {
    origin: config.MINI_APP_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
    exposedHeaders: ['x-correlation-id'],
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', request.id);
    if (request.url.startsWith('/api/'))
      reply.header('cache-control', 'no-store');
  });
  registerHttpErrors(app);
  registerOpenApiRoute(app);
  registerInventoryRoutes(app, services);
  registerHealthRoutes(app, services.checkReadiness);
  registerAuthRoutes(app, services.verifyTelegramSession);
  registerTelegramWebhook(app, {
    secret: config.TELEGRAM_WEBHOOK_SECRET,
    deliverUpdate: services.deliverTelegramUpdate,
  });
  return app;
}
