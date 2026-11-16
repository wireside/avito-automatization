import type { SessionUser } from '../auth/verify-telegram-session.js';
/** A short-lived bearer capability for one label; redemption refreshes user access. */
export interface LabelDownloadLinks {
  issue(
    user: SessionUser,
    orderId: string,
    operationId: string,
  ): { url: string; expiresAt: string };
  resolve(
    ticket: string,
  ): Promise<{ user: SessionUser; orderId: string; operationId: string }>;
}
