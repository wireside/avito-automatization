import { registerAvitoActionRoutes } from './routes/order-actions.js';
import type { AvitoOrderActions } from '@avito/domain';
import { registerSignerEnrollmentRoutes } from './routes/signer-enrollment.js';
import type { SignerEnrollment, SignerBinding } from '@avito/domain';
import { registerLocalSignerRoutes } from './routes/local-signer.js';
import type { LocalSignerService } from '@avito/domain';
import { registerMarkingRoutes } from './routes/marking.js';
import type { MarkingPipeline } from '@avito/domain';
import cors from '@fastify/cors';
import { createLogger } from '@avito/observability';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/index.js';
import type { SessionResult, ReadInventory, ReceiveStock } from '@avito/domain';
import type { ReadOrders } from '@avito/domain';
import { registerOrderRoutes } from './routes/orders.js';
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
  avitoOrderActions?: AvitoOrderActions;
  localSigner?: LocalSignerService;
  localSignerToken?: string;
  signerEnrollment?: SignerEnrollment;
  signerInstaller?: (connection: {
    backendUrl: string;
    ticket: string;
  }) => Promise<Uint8Array>;
  authenticateSigner?: (
    token: string,
  ) => Promise<{ binding: SignerBinding; service: LocalSignerService } | null>;
  markingPipeline?: MarkingPipeline;
  verifyTelegramSession: (initData: string) => Promise<SessionResult>;
  checkReadiness: () => Promise<DependencyReadiness>;
  deliverTelegramUpdate?: DeliverTelegramUpdate;
  receiveStock?: ReceiveStock;
  readInventory?: ReadInventory;
  readOrders?: ReadOrders;
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
  registerMarkingRoutes(app, services);
  registerSignerEnrollmentRoutes(app, services);
  registerLocalSignerRoutes(
    app,
    services.localSigner,
    services.localSignerToken,
    services.authenticateSigner,
  );
  registerOrderRoutes(app, services);
  registerAvitoActionRoutes(app, services);
  registerHealthRoutes(app, services.checkReadiness);
  registerAuthRoutes(app, services.verifyTelegramSession);
  registerTelegramWebhook(app, {
    secret: config.TELEGRAM_WEBHOOK_SECRET,
    deliverUpdate: services.deliverTelegramUpdate,
  });
  return app;
}
