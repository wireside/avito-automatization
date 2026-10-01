import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  TelegramInitDataError,
  validateTelegramInitData,
} from './telegram-init-data.js';

const token = '123456:test-token';
const now = new Date('2026-10-01T10:00:00.000Z');

function sign(values: Record<string, string>): string {
  const params = new URLSearchParams(values);
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set(
    'hash',
    createHmac('sha256', secret).update(dataCheckString).digest('hex'),
  );
  return params.toString();
}

describe('Telegram initData validation', () => {
  it('verifies signature and auth age', () => {
    const initData = sign({
      auth_date: String(now.getTime() / 1_000),
      query_id: 'query-1',
      user: JSON.stringify({ id: 42, first_name: 'Warehouse' }),
    });
    const result = validateTelegramInitData(initData, token, { now });
    expect(result.user?.id).toBe(42);
  });

  it('rejects expired data', () => {
    const initData = sign({ auth_date: String(now.getTime() / 1_000 - 3_601) });
    try {
      validateTelegramInitData(initData, token, { now });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(TelegramInitDataError);
      expect((error as TelegramInitDataError).code).toBe('EXPIRED');
    }
  });
});
