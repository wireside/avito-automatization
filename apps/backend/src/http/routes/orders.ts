import {
  orderParamsSchema,
  ordersQuerySchema,
  ordersPageResponseSchema,
  orderResponseSchema,
} from '@avito/contracts';
import type { ReadOrders, SessionResult } from '@avito/domain';
import type { FastifyInstance } from 'fastify';
import { createHttpAuthentication } from '../authentication.js';
import { sendApiError } from '../errors.js';
export function registerOrderRoutes(
  app: FastifyInstance,
  services: {
    verifyTelegramSession: (initData: string) => Promise<SessionResult>;
    readOrders?: ReadOrders;
  },
) {
  const authenticate = createHttpAuthentication(services.verifyTelegramSession);
  app.get('/api/v1/orders', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const query = ordersQuerySchema.safeParse(request.query);
    if (!query.success) return sendApiError(reply, request, 'INVALID_REQUEST');
    if (!services.readOrders)
      return sendApiError(reply, request, 'AVITO_NOT_CONFIGURED');
    const result = await services.readOrders.list(user, query.data);
    if (!result.ok) return sendApiError(reply, request, result.code);
    return ordersPageResponseSchema.parse(result);
  });
  app.get('/api/v1/orders/:id', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const params = orderParamsSchema.safeParse(request.params);
    if (!params.success) return sendApiError(reply, request, 'INVALID_REQUEST');
    if (!services.readOrders)
      return sendApiError(reply, request, 'AVITO_NOT_CONFIGURED');
    const result = await services.readOrders.get(user, params.data.id);
    if (!result.ok) return sendApiError(reply, request, result.code);
    return orderResponseSchema.parse(result);
  });
  app.post(
    '/api/v1/orders/:id/confirm',
    { bodyLimit: 1024 },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      if (!orderParamsSchema.safeParse(request.params).success)
        return sendApiError(reply, request, 'INVALID_REQUEST');
      if (!services.readOrders)
        return sendApiError(reply, request, 'AVITO_NOT_CONFIGURED');
      return sendApiError(
        reply,
        request,
        services.readOrders.confirm(user).code,
      );
    },
  );
}
