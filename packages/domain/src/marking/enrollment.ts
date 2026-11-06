import type { SessionUser } from '../auth/verify-telegram-session.js';
import { requirePipeline } from './pipeline.js';
export interface SignerBinding {
  signerId: string;
  sellerInn: string;
  certificateThumbprint: string;
}
export interface SignerCandidate extends SignerBinding {
  id: string;
  status: string;
  pairingCode: string;
  certificateExpiresAt: string;
}
export interface SignerRegistration {
  ticket: string;
  signerId: string;
  deviceTokenHash: string;
  pairingCode: string;
  certificateBase64: string;
}
export interface SignerCertificate {
  sellerInn: string;
  certificateThumbprint: string;
  certificateExpiresAt: string;
}
export interface SignerEnrollmentStore {
  createTicket(ownerId: string): Promise<{ ticket: string; expiresAt: string }>;
  validTicket(ticket: string): Promise<boolean>;
  register(
    input: Omit<SignerRegistration, 'certificateBase64'> & SignerCertificate,
  ): Promise<{ id: string; status: string }>;
  decide(ownerId: string, id: string, approve: boolean): Promise<void>;
  list(ownerId: string): Promise<SignerCandidate[]>;
  binding(token: string): Promise<SignerBinding | null>;
  status(token: string): Promise<{ status: string }>;
  hasActive(): Promise<boolean>;
  notification(
    id: string,
  ): Promise<(SignerCandidate & { telegramId: string }) | null>;
  notified(id: string, messageId: number): Promise<void>;
}
export function createSignerEnrollment(deps: {
  store: SignerEnrollmentStore;
  publicUrl: string;
  inspectCertificate: (base64: string) => SignerCertificate;
}) {
  const owner = (user: SessionUser) =>
    requirePipeline(user.roles.includes('OWNER'), 'FORBIDDEN');
  return {
    async issue(user: SessionUser) {
      owner(user);
      const t = await deps.store.createTicket(user.id);
      return {
        url: deps.publicUrl + '/signer/install#' + t.ticket,
        expiresAt: t.expiresAt,
      };
    },
    async download(ticket: string) {
      requirePipeline(
        await deps.store.validTicket(ticket),
        'INSTALL_LINK_EXPIRED',
      );
      return { backendUrl: deps.publicUrl, ticket };
    },
    async register(input: SignerRegistration) {
      requirePipeline(
        await deps.store.validTicket(input.ticket),
        'INSTALL_LINK_EXPIRED',
      );
      const cert = deps.inspectCertificate(input.certificateBase64);
      return deps.store.register({
        ticket: input.ticket,
        signerId: input.signerId,
        deviceTokenHash: input.deviceTokenHash,
        pairingCode: input.pairingCode,
        ...cert,
      });
    },
    async decide(user: SessionUser, id: string, approve: boolean) {
      owner(user);
      await deps.store.decide(user.id, id, approve);
    },
    async list(user: SessionUser) {
      owner(user);
      return deps.store.list(user.id);
    },
    authorize: (token: string) => deps.store.binding(token),
    status: (token: string) => deps.store.status(token),
  };
}
export type SignerEnrollment = ReturnType<typeof createSignerEnrollment>;

export function createNotifySigner(
  store: SignerEnrollmentStore,
  send: (notice: SignerCandidate & { telegramId: string }) => Promise<number>,
) {
  return async (operationId: string) => {
    const notice = await store.notification(operationId);
    if (!notice) return;
    const messageId = await send(notice);
    await store.notified(notice.id, messageId);
  };
}
