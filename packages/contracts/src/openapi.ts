import {
  ordersQuerySchema,
  ordersPageResponseSchema,
  orderResponseSchema,
} from './orders.js';
import { z } from 'zod';
import {
  apiErrorResponseSchema,
  telegramAuthRequestSchema,
  telegramAuthResponseSchema,
} from './http.js';
import {
  inventoryListQuerySchema,
  inventoryUnitsQuerySchema,
  inventoryPageResponseSchema,
  inventoryUnitsResponseSchema,
  inventoryScanRequestSchema,
  inventoryScanResponseSchema,
  inventoryUnitSchema,
} from './inventory.js';

// Reuse the same Zod schemas for runtime validation, inferred DTOs and OpenAPI.
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonResponse = (name: string, description: string) => ({
  description,
  headers: {
    'x-correlation-id': {
      description: 'Server HTTP request ID, useful for support and logs.',
      schema: { type: 'string' },
    },
  },
  content: { 'application/json': { schema: ref(name) } },
});
function queryParameters(schema: z.ZodObject) {
  return Object.entries(schema.shape).map(
    ([name, value]: [string, z.ZodType]) => ({
      name,
      in: 'query',
      required: !value.safeParse(undefined).success,
      schema: z.toJSONSchema(value),
    }),
  );
}
const authErrors = {
  '401': jsonResponse(
    'ApiError',
    'Missing, malformed, invalid or expired Telegram initData.',
  ),
  '403': jsonResponse(
    'ApiError',
    'User not allowed or role cannot perform the operation.',
  ),
  '503': jsonResponse(
    'ApiError',
    'Authentication, catalog or inventory service is not configured, provider unavailable, or destination unavailable.',
  ),
};
const commonErrors = {
  '400': jsonResponse(
    'ApiError',
    'INVALID_REQUEST or INVALID_JSON. The scenario was not invoked.',
  ),
  '500': jsonResponse(
    'ApiError',
    'INTERNAL_ERROR. No implementation details are returned; retry the same scan UUID if the result is uncertain.',
  ),
};
const security = [{ telegramInitData: [] }];
export function createPublicApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Avito warehouse API',
      version: '1.0.0',
      description:
        'Read-only live Avito orders, scanned intake and stock browsing. Matching National Catalog data completes receipt directly into AVAILABLE, without approval. CHZ, EDI and Avito mutations are outside this API slice.',
    },
    servers: [{ url: '/', description: 'The origin serving this API.' }],
    components: {
      securitySchemes: {
        telegramInitData: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description:
            'tma <Telegram.WebApp.initData>. Verified with the active-user allowlist on every request. No standalone JWT or client-selected actor.',
        },
      },
      schemas: {
        OrdersPageResponse: z.toJSONSchema(ordersPageResponseSchema),
        OrderResponse: z.toJSONSchema(orderResponseSchema),
        ApiError: z.toJSONSchema(apiErrorResponseSchema),
        TelegramAuthRequest: z.toJSONSchema(telegramAuthRequestSchema),
        TelegramAuthResponse: z.toJSONSchema(telegramAuthResponseSchema),
        InventoryScanRequest: z.toJSONSchema(inventoryScanRequestSchema),
        InventoryScanResponse: z.toJSONSchema(inventoryScanResponseSchema),
        InventoryPageResponse: z.toJSONSchema(inventoryPageResponseSchema),
        InventoryUnitsResponse: z.toJSONSchema(inventoryUnitsResponseSchema),
        InventoryUnit: z.toJSONSchema(inventoryUnitSchema),
      },
    },
    paths: {
      '/api/v1/orders': {
        get: {
          operationId: 'listAvitoOrders',
          summary:
            'Read a page of live Avito orders. No local intake or reservations.',
          tags: ['Orders'],
          security,
          parameters: queryParameters(ordersQuerySchema),
          responses: {
            '200': jsonResponse(
              'OrdersPageResponse',
              'Observed live orders, provider pagination, fetch timestamp; mode read_only. Amounts are integer kopecks; missing prices remain null.',
            ),
            ...commonErrors,
            ...authErrors,
            '429': jsonResponse('ApiError', 'AVITO_RATE_LIMITED. Retry later.'),
          },
        },
      },
      '/api/v1/orders/{id}': {
        get: {
          operationId: 'getAvitoOrder',
          summary:
            'Read live order, delivery tracking number, status and provider available actions.',
          tags: ['Orders'],
          security,
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[0-9]{1,32}$' },
            },
          ],
          responses: {
            '200': jsonResponse(
              'OrderResponse',
              'Latest observed provider state, not a locally persisted status history. No carrier tracking URL or detailed events are fabricated.',
            ),
            ...commonErrors,
            ...authErrors,
            '404': jsonResponse('ApiError', 'ORDER_NOT_FOUND.'),
            '429': jsonResponse('ApiError', 'AVITO_RATE_LIMITED.'),
          },
        },
      },
      '/api/v1/orders/{id}/confirm': {
        post: {
          operationId: 'confirmAvitoOrderDisabled',
          summary:
            'Disabled confirmation placeholder: never sends a provider request.',
          tags: ['Orders'],
          security,
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[0-9]{1,32}$' },
            },
          ],
          responses: {
            ...commonErrors,
            ...authErrors,
            '409': jsonResponse(
              'ApiError',
              'ORDER_ACTIONS_DISABLED. No state was changed. OWNER, ADMIN, WAREHOUSE only; other roles 403.',
            ),
          },
        },
      },
      '/api/v1/auth/telegram/verify': {
        post: {
          operationId: 'verifyTelegramSession',
          summary:
            'Verify the Telegram session and get the current user and roles.',
          tags: ['Authentication'],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: ref('TelegramAuthRequest') },
            },
          },
          responses: {
            '200': jsonResponse(
              'TelegramAuthResponse',
              'Authenticated active user. Continue sending initData with protected requests.',
            ),
            ...commonErrors,
            ...authErrors,
            '413': jsonResponse(
              'ApiError',
              'PAYLOAD_TOO_LARGE. Maximum auth body size is 32768 bytes.',
            ),
            '415': jsonResponse(
              'ApiError',
              'UNSUPPORTED_MEDIA_TYPE. Send application/json.',
            ),
          },
        },
      },
      '/api/v1/inventory': {
        get: {
          operationId: 'listInventory',
          summary: 'List variants and warehouse totals.',
          tags: ['Inventory'],
          security,
          description:
            'OWNER, ADMIN, WAREHOUSE, ACCOUNTANT and VIEWER. One MAIN warehouse. Group by productId when present; otherwise keep each variant separate. Totals cover the entire warehouse; search and pagination apply to items. With hasMore=true, request offset+limit.',
          parameters: queryParameters(inventoryListQuerySchema),
          responses: {
            '200': jsonResponse(
              'InventoryPageResponse',
              'Current warehouse totals and a page of variants.',
            ),
            ...commonErrors,
            ...authErrors,
          },
        },
      },
      '/api/v1/inventory/variants/{id}/units': {
        get: {
          operationId: 'listInventoryUnits',
          summary: 'List masked units currently held in this warehouse.',
          tags: ['Inventory'],
          security,
          description:
            'Same read roles as listInventory. Fixed page size: 20. With hasMore=true, request offset+20. Unknown variant UUID returns an empty page. Full marking, ciphertext and fingerprints are never returned.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            ...queryParameters(inventoryUnitsQuerySchema),
          ],
          responses: {
            '200': jsonResponse(
              'InventoryUnitsResponse',
              'A page of individual units with receipt references.',
            ),
            ...commonErrors,
            ...authErrors,
          },
        },
      },
      '/api/v1/inventory/receipts/scan': {
        post: {
          operationId: 'receiveInventoryScan',
          summary: 'Receive one marked physical unit.',
          tags: ['Inventory'],
          security,
          description:
            'OWNER, ADMIN and WAREHOUSE. A fresh scan uses a new UUID; a network retry keeps the UUID and exact raw string/profile. Same UUID with another payload returns 409. Another scan of the same GTIN+serial returns DUPLICATE without another movement. The same user scope owns the idempotency UUID. A replay keeps the original outcome and sets replayed=true. Matching National Catalog data for the scanned GTIN is required and reused from stored evidence. A successful receipt immediately enters AVAILABLE with saved attributes; there is no review workflow. Missing/unavailable/ambiguous cards create no provisional unit. Optional missing attributes remain null. This does not fabricate legal CHZ facts. Stock reads show the committed result.',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: ref('InventoryScanRequest') },
            },
          },
          responses: {
            '201': jsonResponse(
              'InventoryScanResponse',
              'A new unit and its posted receipt/movement have committed.',
            ),
            '200': jsonResponse(
              'InventoryScanResponse',
              'Duplicate identity or replay of an earlier request. No new unit was added.',
            ),
            ...commonErrors,
            ...authErrors,
            '409': jsonResponse(
              'ApiError',
              'IDEMPOTENCY_CONFLICT, CATALOG_ARCHIVED or CATALOG_AMBIGUOUS.',
            ),
            '413': jsonResponse(
              'ApiError',
              'PAYLOAD_TOO_LARGE. Maximum scan body size is 4096 bytes.',
            ),
            '415': jsonResponse(
              'ApiError',
              'UNSUPPORTED_MEDIA_TYPE. Send application/json.',
            ),
            '422': jsonResponse(
              'ApiError',
              'INVALID_MARKING, INVALID_GTIN or CATALOG_NOT_FOUND. No receipt was created.',
            ),
          },
        },
      },
    },
  };
}
