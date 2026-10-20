import { describe, expect, it, vi } from 'vitest';
import { createGrantOwnerAccess } from './grant-owner-access.js';

describe('explicit owner access', () => {
  it.each(['', '@username', '-1', '1.5', '9007199254740992'])(
    'rejects invalid user ID %s before writing',
    async (telegramId) => {
      const persist = vi.fn().mockResolvedValue(undefined);
      await expect(
        createGrantOwnerAccess(persist)({ telegramId, correlationId: 'test' }),
      ).rejects.toThrow('numeric Telegram user ID');
      expect(persist).not.toHaveBeenCalled();
    },
  );
  it('preserves the operator correlation ID at the persistence boundary', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    await createGrantOwnerAccess(persist)({
      telegramId: '42',
      correlationId: 'trace',
    });
    expect(persist).toHaveBeenCalledWith({
      telegramId: '42',
      correlationId: 'trace',
    });
  });
});
