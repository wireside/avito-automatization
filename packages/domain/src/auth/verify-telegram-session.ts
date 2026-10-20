export interface SessionUser {
  id: string;
  telegramId: string;
  displayName: string | null;
  roles: string[];
}

export type IdentityFailureCode =
  'TELEGRAM_NOT_CONFIGURED' | 'MALFORMED' | 'INVALID_SIGNATURE' | 'EXPIRED';
export type VerifiedIdentity =
  | { ok: true; telegramId: string | undefined }
  | { ok: false; code: IdentityFailureCode };
export type SessionFailureCode =
  IdentityFailureCode | 'TELEGRAM_USER_MISSING' | 'USER_NOT_ALLOWED';
export type SessionResult =
  { ok: true; user: SessionUser } | { ok: false; code: SessionFailureCode };

export interface VerifyTelegramSessionDependencies {
  verifyIdentity: (initData: string) => VerifiedIdentity;
  findActiveUser: (telegramId: string) => Promise<SessionUser | undefined>;
}

export function createVerifyTelegramSession(
  dependencies: VerifyTelegramSessionDependencies,
) {
  return async (initData: string): Promise<SessionResult> => {
    const identity = dependencies.verifyIdentity(initData);
    if (!identity.ok) return identity;
    if (!identity.telegramId)
      return { ok: false, code: 'TELEGRAM_USER_MISSING' };
    const user = await dependencies.findActiveUser(identity.telegramId);
    if (!user) return { ok: false, code: 'USER_NOT_ALLOWED' };
    return { ok: true, user };
  };
}
