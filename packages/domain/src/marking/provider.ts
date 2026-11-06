import { PipelineError } from './pipeline.js';
export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = false,
    public readonly ambiguous = false,
  ) {
    super(code);
    this.name = code;
  }
}
export interface CodeObservation {
  cis: string;
  status: string;
  statusEx: string;
  ownerInn: string;
  observedAt: string;
}
export interface ProviderDocument {
  id: string;
  status: string;
  senderInn: string;
  receiverInn: string;
  type: string;
  body: unknown;
}
export interface SignedPayload {
  signatureBase64: string;
  certificateBase64: string;
  payloadHash: string;
}
export interface LegalProvider {
  authorizeSubmission(): Promise<void>;
  check(cises: string[]): Promise<CodeObservation[]>;
  document(id: string): Promise<ProviderDocument>;
  submit(input: {
    type: string;
    payloadBase64: string;
    signatureBase64: string;
  }): Promise<string>;
}
export type MarkingWork =
  | {
      kind: 'check';
      unitId: string;
      cis: string;
      sellerInn: string;
      documentId: string | null;
      supplierInn: string | null;
    }
  | {
      kind: 'markings';
      shipmentId: string;
      externalOrderId: string;
      items: { avitoId: string; markings: string[] }[];
    }
  | {
      kind: 'document';
      documentId: string;
      documentType: string;
      status: string;
      externalId: string | null;
      payloadBase64: string;
      payloadHash: string;
      sellerInn: string;
      items: { cis: string; target: 'INTRODUCED' | 'RETIRED' }[];
      submissionStarted: boolean;
    };
export interface MarkingWorkStore {
  load(id: string): Promise<MarkingWork | null>;
  checked(
    work: Extract<MarkingWork, { kind: 'check' }>,
    observation: CodeObservation,
    supplyVerified: boolean,
  ): Promise<void>;
  markingsAccepted(shipmentId: string): Promise<void>;
  signature(documentId: string): Promise<SignedPayload | null>;
  awaitingSignature(documentId: string): Promise<void>;
  submissionStarted(documentId: string): Promise<void>;
  submitted(documentId: string, externalId: string): Promise<void>;
  processed(
    documentId: string,
    document: ProviderDocument,
    observations: CodeObservation[],
  ): Promise<void>;
  defer(id: string, code: string, delaySeconds?: number): Promise<void>;
}
function hasCis(value: unknown, cis: string): boolean {
  if (
    !value ||
    typeof value !== 'object' ||
    !('products' in value) ||
    !Array.isArray(value.products)
  )
    return false;
  return value.products.some(
    (p: unknown) =>
      p &&
      typeof p === 'object' &&
      'code' in p &&
      p.code === cis &&
      'codeType' in p &&
      p.codeType === 'EXEMPLARY',
  );
}
/** Provider calls happen outside warehouse SQL transactions. HTTP success is never final legal success. */
export function createMarkingExecutor(deps: {
  store: MarkingWorkStore;
  legal: LegalProvider;
  sendMarkings: (
    work: Extract<MarkingWork, { kind: 'markings' }>,
  ) => Promise<void>;
  submissionsEnabled: boolean;
}) {
  return async (id: string) => {
    const work = await deps.store.load(id);
    if (!work) return;
    try {
      if (work.kind === 'check') {
        const observations = await deps.legal.check([work.cis]);
        const observation = observations.find((o) => o.cis === work.cis);
        if (!observation)
          throw new ProviderError('CHZ_CODE_RESPONSE_INCOMPLETE');
        let verified = false;
        if (work.documentId) {
          const doc = await deps.legal.document(work.documentId);
          verified =
            doc.status === 'CHECKED_OK' &&
            doc.receiverInn === work.sellerInn &&
            doc.senderInn === work.supplierInn &&
            [
              'UNIVERSAL_TRANSFER_DOCUMENT',
              'UNIVERSAL_TRANSFER_DOCUMENT_FIX',
            ].includes(doc.type) &&
            hasCis(doc.body, work.cis);
        }
        await deps.store.checked(work, observation, verified);
        return;
      }
      if (work.kind === 'markings') {
        await deps.sendMarkings(work);
        await deps.store.markingsAccepted(work.shipmentId);
        return;
      }
      if (['CONFIRMED', 'CANCELLED'].includes(work.status)) return;
      if (work.externalId) {
        const doc = await deps.legal.document(work.externalId);
        if (doc.type !== work.documentType)
          throw new ProviderError('CHZ_DOCUMENT_TYPE_MISMATCH');
        if (
          ['IN_PROGRESS', 'PROCESSING', 'NEW', 'CHECKING'].includes(doc.status)
        ) {
          await deps.store.defer(id, 'CHZ_PROCESSING', 15);
          return;
        }
        const codes = await deps.legal.check(work.items.map((i) => i.cis));
        await deps.store.processed(work.documentId, doc, codes);
        return;
      }
      if (work.submissionStarted) {
        await deps.store.defer(id, 'SUBMISSION_RESULT_UNKNOWN');
        return;
      }
      const signature = await deps.store.signature(work.documentId);
      if (!signature) {
        await deps.store.awaitingSignature(work.documentId);
        await deps.store.defer(id, 'SIGNER_WAITING', 15);
        return;
      }
      if (signature.payloadHash !== work.payloadHash)
        throw new ProviderError('SIGNATURE_PAYLOAD_MISMATCH');
      if (!deps.submissionsEnabled) {
        await deps.store.defer(id, 'DOCUMENT_SUBMISSION_DISABLED', 60);
        return;
      }
      await deps.legal.authorizeSubmission();
      await deps.store.submissionStarted(work.documentId);
      const externalId = await deps.legal.submit({
        type: work.documentType,
        payloadBase64: work.payloadBase64,
        signatureBase64: signature.signatureBase64,
      });
      await deps.store.submitted(work.documentId, externalId);
      await deps.store.defer(id, 'CHZ_PROCESSING', 15);
    } catch (error) {
      if (error instanceof ProviderError || error instanceof PipelineError) {
        await deps.store.defer(
          id,
          error.code,
          error instanceof ProviderError && error.retryable && !error.ambiguous
            ? 30
            : undefined,
        );
        return;
      }
      throw error;
    }
  };
}
