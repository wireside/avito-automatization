import { z } from 'zod';

export const warehouseSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  isDefault: z.boolean(),
  address: z.string().nullable(),
  configured: z.boolean(),
});
export const warehouseListSchema = z.object({
  ok: z.literal(true),
  items: z.array(warehouseSummarySchema),
});
export const chzConnectionSchema = z.object({
  ok: z.literal(true),
  sellerInn: z.string().nullable(),
  canChangeInn: z.boolean().default(false),
  signerActive: z.boolean(),
  authorized: z.boolean(),
});
export const chzConnectRequest = z
  .object({ sellerInn: z.string().regex(/^\d{12}$/) })
  .strict();
export const chzPlacesSchema = z.object({
  ok: z.literal(true),
  sellerInn: z.string(),
  items: z.array(z.object({ fiasId: z.uuid(), address: z.string().min(1) })),
  incompleteCount: z.number().int().nonnegative(),
});
export const warehouseSaveRequest = z
  .object({
    requestId: z.uuid(),
    warehouseId: z.uuid().optional(),
    name: z.string().trim().min(1).max(200),
    fiasId: z.uuid(),
  })
  .strict();
export const warehouseSaveResponse = z.object({
  ok: z.literal(true),
  warehouseId: z.uuid(),
});
export type WarehouseSummaryDto = z.infer<typeof warehouseSummarySchema>;

export function warehouseOpenApiPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [method, path, operationId, request, response] of [
    ['get', '/api/v1/warehouses', 'listWarehouses', null, warehouseListSchema],
    [
      'post',
      '/api/v1/warehouses',
      'saveWarehouse',
      warehouseSaveRequest,
      warehouseSaveResponse,
    ],
    [
      'get',
      '/api/v1/chz/connection',
      'getChzConnection',
      null,
      chzConnectionSchema,
    ],
    [
      'post',
      '/api/v1/chz/connection',
      'connectChz',
      chzConnectRequest,
      chzConnectionSchema,
    ],
    ['get', '/api/v1/chz/places', 'listChzPlaces', null, chzPlacesSchema],
  ] as const) {
    const failure = {
      description: 'Authentication, role, provider or configuration error',
    };
    paths[path] = {
      ...(paths[path] ?? {}),
      [method]: {
        operationId,
        tags: ['Warehouses'],
        security: [{ telegramInitData: [] }],
        ...(request
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': { schema: z.toJSONSchema(request) },
                },
              },
            }
          : {}),
        responses: {
          '200': {
            description: 'Verified local or provider data',
            content: {
              'application/json': { schema: z.toJSONSchema(response) },
            },
          },
          '400': failure,
          '401': failure,
          '403': failure,
          '409': failure,
          '503': failure,
        },
      },
    };
  }
  return paths;
}
