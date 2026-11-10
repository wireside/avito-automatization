import { it, expect, vi } from 'vitest';
import {
  createMarkingExecutor,
  ProviderError,
  type MarkingWorkStore,
  type MarkingWork,
  type LegalProvider,
} from './provider.js';
function setup(work: MarkingWork, enabled = false) {
  const store = {
    load: vi.fn().mockResolvedValue(work),
    checked: vi.fn(),
    markingsAccepted: vi.fn(),
    signature: vi.fn<MarkingWorkStore['signature']>().mockResolvedValue(null),
    awaitingSignature: vi.fn(),
    submissionStarted: vi.fn(),
    submitted: vi.fn(),
    processed: vi.fn(),
    defer: vi.fn(),
  } satisfies MarkingWorkStore;
  const legal = {
    authorizeSubmission: vi.fn(),
    check: vi.fn<LegalProvider['check']>().mockResolvedValue([]),
    document: vi.fn(),
    submit: vi.fn(),
  };
  const sendMarkings = vi.fn();
  return {
    store,
    legal,
    sendMarkings,
    execute: createMarkingExecutor({
      store,
      legal,
      sendMarkings,
      submissionsEnabled: enabled,
    }),
  };
}
const doc: MarkingWork = {
  kind: 'document',
  documentId: 'd',
  documentType: 'LK_RECEIPT',
  status: 'PREPARING',
  externalId: null,
  payloadBase64: 'e30=',
  payloadHash: 'hash',
  sellerInn: '123456789012',
  items: [{ cis: 'cis', target: 'RETIRED' }],
  submissionStarted: false,
};
it('never submits when legal sending is disabled even with a verified signature', async () => {
  const f = setup(doc);
  f.store.signature.mockResolvedValue({
    signatureBase64: 'sig',
    certificateBase64: 'cert',
    payloadHash: 'hash',
  });
  await f.execute('job');
  expect(f.legal.submit).not.toHaveBeenCalled();
  expect(f.store.defer).toHaveBeenCalledWith(
    'job',
    'DOCUMENT_SUBMISSION_DISABLED',
    60,
  );
});
it('waits for the actual signer rather than manufacturing a signature', async () => {
  const f = setup(doc, true);
  await f.execute('job');
  expect(f.store.awaitingSignature).toHaveBeenCalledWith('d');
  expect(f.legal.submit).not.toHaveBeenCalled();
});
it('never blindly repeats a submission with an unknown outcome', async () => {
  const f = setup({ ...doc, submissionStarted: true }, true);
  await f.execute('job');
  expect(f.store.defer).toHaveBeenCalledWith(
    'job',
    'SUBMISSION_RESULT_UNKNOWN',
  );
  expect(f.legal.submit).not.toHaveBeenCalled();
});
it('records submission intent before calling provider and polls by returned document ID', async () => {
  const f = setup(doc, true);
  f.store.signature.mockResolvedValue({
    signatureBase64: 'sig',
    certificateBase64: 'cert',
    payloadHash: 'hash',
  });
  f.legal.submit.mockResolvedValue('provider-id');
  await f.execute('job');
  expect(f.store.submissionStarted.mock.invocationCallOrder[0]).toBeLessThan(
    f.legal.submit.mock.invocationCallOrder[0]!,
  );
  expect(f.store.submitted).toHaveBeenCalledWith('d', 'provider-id');
});
it('does not release local markings on provider rejection', async () => {
  const f = setup({
    kind: 'markings',
    shipmentId: 's',
    externalOrderId: 'o',
    items: [],
  });
  f.sendMarkings.mockRejectedValue(
    new ProviderError('AVITO_MARKINGS_NOT_CONFIRMED'),
  );
  await f.execute('job');
  expect(f.store.markingsAccepted).not.toHaveBeenCalled();
});
it('binds legal receipt to the processed incoming document, both INNs and exact code', async () => {
  const f = setup({
    kind: 'check',
    unitId: 'u',
    cis: 'cis',
    sellerInn: '123',
    documentId: 'upd',
    supplierInn: '456',
  });
  f.legal.check.mockResolvedValue([
    {
      cis: 'cis',
      status: 'INTRODUCED',
      statusEx: 'EMPTY',
      ownerInn: '123',
      observedAt: 'now',
    },
  ]);
  f.legal.document.mockResolvedValue({
    id: 'upd',
    status: 'CHECKED_OK',
    senderInn: '456',
    receiverInn: '123',
    type: 'UNIVERSAL_TRANSFER_DOCUMENT',
    body: {
      products: [{ code: 'other', codeType: 'EXEMPLARY' }],
      productsTotal: 1,
    },
  });
  await f.execute('job');
  expect(f.store.checked).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.anything(),
    false,
  );
  f.legal.document.mockResolvedValue({
    id: 'upd',
    status: 'CHECKED_OK',
    senderInn: '456',
    receiverInn: '123',
    type: 'UNIVERSAL_TRANSFER_DOCUMENT',
    body: {
      products: [{ code: 'cis', codeType: 'EXEMPLARY' }],
      productsTotal: 1,
    },
  });
  await f.execute('job');
  expect(f.store.checked).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.anything(),
    true,
  );
});

it('ignores cancelled legal documents even if a stale queue job runs', async () => {
  const f = setup({ ...doc, status: 'CANCELLED' }, true);
  await f.execute('job');
  expect(f.legal.submit).not.toHaveBeenCalled();
  expect(f.store.awaitingSignature).not.toHaveBeenCalled();
});

it('waits for authorization without recording a document submission attempt', async () => {
  const f = setup(doc, true);
  f.store.signature.mockResolvedValue({
    signatureBase64: 'sig',
    certificateBase64: 'cert',
    payloadHash: 'hash',
  });
  f.legal.authorizeSubmission.mockRejectedValue(
    new ProviderError('CHZ_AUTH_REQUIRED', true),
  );
  await f.execute('job');
  expect(f.store.submissionStarted).not.toHaveBeenCalled();
  expect(f.legal.submit).not.toHaveBeenCalled();
  expect(f.store.defer).toHaveBeenCalledWith('job', 'CHZ_AUTH_REQUIRED', 30);
});

it('revalidates a delayed signed withdrawal before starting any legal submission', async () => {
  const f = setup({ ...doc, shipmentId: 'shipment' }, true);
  f.store.signature.mockResolvedValue({
    signatureBase64: 'sig',
    certificateBase64: 'cert',
    payloadHash: 'hash',
  });
  const guard = vi
    .fn()
    .mockRejectedValue(new ProviderError('ORDER_NOT_AVAILABLE'));
  await createMarkingExecutor({
    store: f.store,
    legal: f.legal,
    sendMarkings: f.sendMarkings,
    submissionsEnabled: true,
    beforeDocumentSubmit: guard,
  })('job');
  expect(guard).toHaveBeenCalled();
  expect(f.store.submissionStarted).not.toHaveBeenCalled();
  expect(f.legal.submit).not.toHaveBeenCalled();
  expect(f.store.defer).toHaveBeenCalledWith(
    'job',
    'ORDER_NOT_AVAILABLE',
    undefined,
  );
});
