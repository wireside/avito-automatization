import { requirePipeline } from './pipeline.js';
/** Payload is immutable UTF-8 bytes. Signer uses detached CMS/CAdES and keeps key/PIN locally. */
export interface SigningLease {
  taskId: string;
  leaseId: string;
  documentId: string;
  documentType: string;
  sellerInn: string;
  payloadBase64: string;
  payloadHash: string;
  expiresAt: string;
  simulated: boolean;
  algorithm: 'GOST_CMS_DETACHED';
}
export interface SignatureSubmission {
  taskId: string;
  leaseId: string;
  signerId: string;
  payloadHash: string;
  signatureBase64: string;
  certificateBase64: string;
}
export interface LocalSigningStore {
  claim(input: {
    signerId: string;
    acceptSimulation: boolean;
  }): Promise<SigningLease | null>;
  receive(input: SignatureSubmission): Promise<{
    taskId: string;
    state: 'RECEIVED';
    verified: false;
    replayed: boolean;
  }>;
}
export function createLocalSignerService(store: LocalSigningStore) {
  return {
    claim: (input: { signerId: string; acceptSimulation: boolean }) =>
      store.claim(input),
    submit: (input: SignatureSubmission) => store.receive(input),
  };
}
/** Trust only a cryptographic verification adapter, never sender-provided certificate fields. */
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
  const result = await verifier.verify(input);
  requirePipeline(
    result.valid && result.certificateValid && result.revocationChecked,
    'SIGNATURE_INVALID',
  );
  requirePipeline(
    result.signerInn === input.expectedInn,
    'SIGNATURE_INN_MISMATCH',
  );
  requirePipeline(
    result.payloadHash === input.expectedHash,
    'SIGNATURE_PAYLOAD_MISMATCH',
  );
  return {
    verified: true as const,
    certificateFingerprint: result.certificateFingerprint,
  };
}
export type LocalSignerService = ReturnType<typeof createLocalSignerService>;
