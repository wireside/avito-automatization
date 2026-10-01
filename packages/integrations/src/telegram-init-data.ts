import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  is_premium: z.boolean().optional(),
});

export interface ValidatedTelegramInitData {
  authDate: Date;
  queryId?: string;
  user?: z.infer<typeof telegramUserSchema>;
}

export class TelegramInitDataError extends Error {
  constructor(
    public readonly code: 'MALFORMED' | 'INVALID_SIGNATURE' | 'EXPIRED',
  ) {
    super(`Telegram initData validation failed: ${code}`);
    this.name = 'TelegramInitDataError';
  }
}

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  options: { now?: Date; maxAgeSeconds?: number } = {},
): ValidatedTelegramInitData {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  const authDateRaw = params.get('auth_date');
  if (!receivedHash || !authDateRaw || !/^\d+$/.test(authDateRaw)) {
    throw new TelegramInitDataError('MALFORMED');
  }

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const expectedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const expected = Buffer.from(expectedHash, 'hex');
  const received = Buffer.from(receivedHash, 'hex');
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw new TelegramInitDataError('INVALID_SIGNATURE');
  }

  const authDateSeconds = Number(authDateRaw);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 3_600;
  if (
    authDateSeconds > nowSeconds + 30 ||
    nowSeconds - authDateSeconds > maxAgeSeconds
  ) {
    throw new TelegramInitDataError('EXPIRED');
  }

  const userRaw = params.get('user');
  let user: z.infer<typeof telegramUserSchema> | undefined;
  if (userRaw) {
    try {
      user = telegramUserSchema.parse(JSON.parse(userRaw));
    } catch {
      throw new TelegramInitDataError('MALFORMED');
    }
  }

  return {
    authDate: new Date(authDateSeconds * 1_000),
    ...(params.get('query_id') ? { queryId: params.get('query_id')! } : {}),
    ...(user ? { user } : {}),
  };
}
