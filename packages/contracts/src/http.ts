import { z } from 'zod';

export const healthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  timestamp: z.iso.datetime(),
});
export const telegramAuthRequestSchema = z
  .object({
    initData: z
      .string()
      .min(1)
      .max(16384)
      .describe('Unmodified Telegram.WebApp.initData, not initDataUnsafe.'),
  })
  .strict();
export const sessionUserSchema = z.object({
  id: z.uuid(),
  telegramId: z.string(),
  displayName: z.string().nullable(),
  roles: z.array(z.string()),
});
export const telegramAuthResponseSchema = z.object({ user: sessionUserSchema });
export const apiErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'TELEGRAM_NOT_CONFIGURED',
  'MALFORMED',
  'INVALID_SIGNATURE',
  'EXPIRED',
  'TELEGRAM_USER_MISSING',
  'USER_NOT_ALLOWED',
  'FORBIDDEN',
  'INVALID_REQUEST',
  'INVALID_JSON',
  'UNSUPPORTED_MEDIA_TYPE',
  'PAYLOAD_TOO_LARGE',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'INVENTORY_NOT_CONFIGURED',
  'MARKING_STORAGE_NOT_CONFIGURED',
  'INVALID_MARKING',
  'INVALID_GTIN',
  'IDEMPOTENCY_CONFLICT',
  'CATALOG_ARCHIVED',
  'WAREHOUSE_UNAVAILABLE',
]);
export const apiErrorResponseSchema = z.object({
  ok: z.literal(false),
  code: apiErrorCodeSchema,
  message: z.string(),
  requestId: z
    .string()
    .describe(
      'HTTP correlation ID, also returned as x-correlation-id. Different from the scan idempotency UUID.',
    ),
});
export type HealthStatus = z.infer<typeof healthStatusSchema>;
export type TelegramAuthRequest = z.infer<typeof telegramAuthRequestSchema>;
export type TelegramAuthResponse = z.infer<typeof telegramAuthResponseSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
