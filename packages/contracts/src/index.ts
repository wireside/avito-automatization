import { z } from 'zod';

export const healthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  timestamp: z.iso.datetime(),
});

export const telegramAuthRequestSchema = z.object({
  initData: z.string().min(1),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
export type TelegramAuthRequest = z.infer<typeof telegramAuthRequestSchema>;
