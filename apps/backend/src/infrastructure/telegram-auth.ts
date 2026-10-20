import {
  TelegramInitDataError,
  validateTelegramInitData,
} from '@avito/integrations';
import type { VerifiedIdentity } from '@avito/domain';

export function createTelegramIdentityVerifier(
  token: string | undefined,
  maxAgeSeconds: number,
) {
  return (initData: string): VerifiedIdentity => {
    if (!token) return { ok: false, code: 'TELEGRAM_NOT_CONFIGURED' };
    try {
      const validated = validateTelegramInitData(initData, token, {
        maxAgeSeconds,
      });
      return {
        ok: true,
        telegramId: validated.user ? String(validated.user.id) : undefined,
      };
    } catch (error) {
      if (error instanceof TelegramInitDataError)
        return { ok: false, code: error.code };
      throw error;
    }
  };
}
