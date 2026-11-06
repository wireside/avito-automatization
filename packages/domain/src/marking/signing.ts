import { requirePipeline } from './pipeline.js';
export interface SigningLease {
  taskId: string;
  leaseId: string;
  documentId: string | null;
  purpose: 'DOCUMENT' | 'AUTH';
  documentType: string;
  sellerInn: string;
  payloadBase64: string;
  payloadHash: string;
  expiresAt: string;
  algorithm: 'GOST_CMS_ATTACHED' | 'GOST_CMS_DETACHED';
}
export interface SignatureSubmission {
  taskId: string;
  leaseId: string;
  signerId: string;
  payloadHash: string;
  signatureBase64: string;
  certificateBase64: string;
  verification: {
    valid: boolean;
    chainValid: boolean;
    revocationChecked: boolean;
    signerInn: string;
    payloadHash: string;
  };
}
export interface LocalSigningStore {
  claim(input: { signerId: string }): Promise<SigningLease | null>;
  receive(input: SignatureSubmission): Promise<{
    taskId: string;
    state: 'VERIFIED';
    verified: true;
    replayed: boolean;
  }>;
  heartbeat(input: {
    signerId: string;
    certificateThumbprint: string;
    certificateExpiresAt: string;
    ready: boolean;
    errorCode?: string | undefined;
  }): Promise<void>;
}
export function createLocalSignerService(store: LocalSigningStore) {
  return {
    claim: (input: { signerId: string }) => store.claim(input),
    submit: (input: SignatureSubmission) => store.receive(input),
    heartbeat: (input: Parameters<LocalSigningStore['heartbeat']>[0]) =>
      store.heartbeat(input),
  };
}
export interface DetachedSignatureVerifier {
  verify(input: {
    payloadBase64: string;
    signatureBase64: string;
    certificateBase64: string;
  }): Promise<{
    valid: boolean;
    signerInn: string;
    payloadHash: string;
    certificateFingerprint: string;
    certificateValid: boolean;
    revocationChecked: boolean;
  }>;
}
export async function verifyLegalSignature(
  verifier: DetachedSignatureVerifier,
  input: {
    payloadBase64: string;
    signatureBase64: string;
    certificateBase64: string;
    expectedInn: string;
    expectedHash: string;
  },
) {
  const r = await verifier.verify(input);
  requirePipeline(
    r.valid && r.certificateValid && r.revocationChecked,
    'SIGNATURE_INVALID',
  );
  requirePipeline(r.signerInn === input.expectedInn, 'SIGNATURE_INN_MISMATCH');
  requirePipeline(
    r.payloadHash === input.expectedHash,
    'SIGNATURE_PAYLOAD_MISMATCH',
  );
  return {
    verified: true as const,
    certificateFingerprint: r.certificateFingerprint,
  };
}
export type LocalSignerService = ReturnType<typeof createLocalSignerService>;
