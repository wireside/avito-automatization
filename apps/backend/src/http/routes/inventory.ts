import {
  inventoryScanRequestSchema,
  inventoryListQuerySchema,
  inventoryUnitsQuerySchema,
  inventoryVariantParamsSchema,
  inventoryPageResponseSchema,
  inventoryUnitsResponseSchema,
  inventoryScanResponseSchema,
} from '@avito/contracts';
import type { FastifyInstance } from 'fastify';
import type { ReadInventory, ReceiveStock, SessionResult } from '@avito/domain';
import { createHttpAuthentication } from '../authentication.js';
import { sendApiError } from '../errors.js';

export interface InventoryHttpServices {
  verifyTelegramSession: (initData: string) => Promise<SessionResult>;
  receiveStock?: ReceiveStock;
  readInventory?: ReadInventory;
}
export function registerInventoryRoutes(
  app: FastifyInstance,
  services: InventoryHttpServices,
) {
  const authenticate = createHttpAuthentication(services.verifyTelegramSession);
  app.get('/api/v1/inventory', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const parsed = inventoryListQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendApiError(reply, request, 'INVALID_REQUEST');
    if (!services.readInventory)
      return sendApiError(reply, request, 'INVENTORY_NOT_CONFIGURED');
    const result = await services.readInventory.list(user, parsed.data);
    if (!result.ok) return sendApiError(reply, request, result.code);
    return inventoryPageResponseSchema.parse(result);
  });
  app.get('/api/v1/inventory/variants/:id/units', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const params = inventoryVariantParamsSchema.safeParse(request.params);
    const query = inventoryUnitsQuerySchema.safeParse(request.query);
    if (!params.success || !query.success)
      return sendApiError(reply, request, 'INVALID_REQUEST');
    if (!services.readInventory)
      return sendApiError(reply, request, 'INVENTORY_NOT_CONFIGURED');
    const result = await services.readInventory.units(
      user,
      params.data.id,
      query.data.offset,
    );
    if (!result.ok) return sendApiError(reply, request, result.code);
    return inventoryUnitsResponseSchema.parse(result);
  });
  app.post(
    '/api/v1/inventory/receipts/scan',
    { bodyLimit: 4096 },
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const parsed = inventoryScanRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return sendApiError(reply, request, 'INVALID_REQUEST');
      if (!services.receiveStock)
        return sendApiError(reply, request, 'INVENTORY_NOT_CONFIGURED');
      const result = await services.receiveStock(user, parsed.data);
      if (!result.ok) return sendApiError(reply, request, result.code);
      return reply
        .code(result.outcome === 'ACCEPTED' && !result.replayed ? 201 : 200)
        .send(inventoryScanResponseSchema.parse(result));
    },
  );
}
