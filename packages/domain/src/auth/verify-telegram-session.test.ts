import { describe, expect, it, vi } from 'vitest';
import {
  createVerifyTelegramSession,
  type VerifiedIdentity,
} from './verify-telegram-session.js';

const user = {
  id: 'local-user',
  telegramId: '42',
  displayName: null,
  roles: ['OWNER'],
};
function setup(identity: VerifiedIdentity) {
  const findActiveUser = vi
    .fn<(id: string) => Promise<typeof user | undefined>>()
    .mockResolvedValue(user);
  return {
    findActiveUser,
    verify: createVerifyTelegramSession({
      verifyIdentity: () => identity,
      findActiveUser,
    }),
  };
}
describe('Telegram session authorization', () => {
  it('does not query user data for an invalid signature', async () => {
    const service = setup({ ok: false, code: 'INVALID_SIGNATURE' });
    expect(await service.verify('untrusted')).toEqual({
      ok: false,
      code: 'INVALID_SIGNATURE',
    });
    expect(service.findActiveUser).not.toHaveBeenCalled();
  });
  it('requires a signed user identity', async () => {
    const service = setup({ ok: true, telegramId: undefined });
    expect(await service.verify('signed')).toEqual({
      ok: false,
      code: 'TELEGRAM_USER_MISSING',
    });
    expect(service.findActiveUser).not.toHaveBeenCalled();
  });
  it('denies a valid Telegram user absent from the active allowlist', async () => {
    const service = setup({ ok: true, telegramId: '42' });
    service.findActiveUser.mockResolvedValue(undefined);
    expect(await service.verify('signed')).toEqual({
      ok: false,
      code: 'USER_NOT_ALLOWED',
    });
  });
  it('returns local roles after signature verification and active-user lookup', async () => {
    const service = setup({ ok: true, telegramId: '42' });
    expect(await service.verify('signed')).toEqual({ ok: true, user });
    expect(service.findActiveUser).toHaveBeenCalledWith('42');
  });
});
