import {
  chzConnectRequest,
  chzConnectionSchema,
  chzPlacesSchema,
  warehouseListSchema,
  warehouseSaveRequest,
  warehouseSaveResponse,
} from '@avito/contracts';
import {
  PipelineError,
  ProviderError,
  type WarehouseSettings,
  type SessionResult,
} from '@avito/domain';
import type { FastifyInstance } from 'fastify';
import { createHttpAuthentication } from '../authentication.js';

export function registerWarehouseRoutes(
  app: FastifyInstance,
  services: {
    verifyTelegramSession: (data: string) => Promise<SessionResult>;
    warehouseSettings?: WarehouseSettings;
  },
) {
  const authenticate = createHttpAuthentication(services.verifyTelegramSession);
  for (const [method, url, action] of [
    ['GET', '/api/v1/warehouses', 'list'],
    ['POST', '/api/v1/warehouses', 'save'],
    ['GET', '/api/v1/chz/connection', 'connection'],
    ['POST', '/api/v1/chz/connection', 'connect'],
    ['GET', '/api/v1/chz/places', 'places'],
  ] as const)
    app.route({
      method,
      url,
      bodyLimit: 4096,
      handler: async (request, reply) => {
        const user = await authenticate(request, reply);
        if (!user) return;
        const fail = (code: string, status: number) =>
          reply
            .code(status)
            .send({ ok: false, code, requestId: request.id, blockers: [] });
        const service = services.warehouseSettings;
        if (!service) return fail('WAREHOUSE_SETTINGS_NOT_CONFIGURED', 503);
        try {
          if (action === 'save') {
            const input = warehouseSaveRequest.safeParse(request.body);
            if (!input.success) return fail('INVALID_REQUEST', 400);
            return warehouseSaveResponse.parse(
              await service.save(user, input.data),
            );
          }
          if (action === 'connect') {
            const input = chzConnectRequest.safeParse(request.body);
            if (!input.success) return fail('INVALID_REQUEST', 400);
            return chzConnectionSchema.parse(
              await service.connect(user, input.data.sellerInn),
            );
          }
          if (action === 'list')
            return warehouseListSchema.parse(await service.list(user));
          if (action === 'connection')
            return chzConnectionSchema.parse(await service.connection(user));
          return chzPlacesSchema.parse(await service.places(user));
        } catch (error) {
          if (error instanceof PipelineError)
            return fail(error.code, error.code === 'FORBIDDEN' ? 403 : 409);
          if (error instanceof ProviderError)
            return fail(
              error.code,
              error.code === 'CHZ_AUTH_REQUIRED' ? 409 : 503,
            );
          throw error;
        }
      },
    });
}
