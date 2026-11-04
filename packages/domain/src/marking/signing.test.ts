import { it, expect, vi } from 'vitest';
import {
  verifyLegalSignature,
  type DetachedSignatureVerifier,
} from './signing.js';
const input = {
  payloadBase64: 'e30=',
  signatureBase64: 'signature',
  certificateBase64: 'certificate',
  expectedInn: '123456789012',
  expectedHash: 'hash',
};
it('accepts only cryptographically verified exact bytes, INN and valid non-revoked certificate', async () => {
  const verify = vi
    .fn<DetachedSignatureVerifier['verify']>()
    .mockResolvedValue({
      valid: true,
      signerInn: input.expectedInn,
      payloadHash: 'hash',
      certificateFingerprint: 'cert',
      certificateValid: true,
      revocationChecked: true,
    });
  expect(await verifyLegalSignature({ verify }, input)).toEqual({
    verified: true,
    certificateFingerprint: 'cert',
  });
  verify.mockResolvedValue({
    valid: true,
    signerInn: '999999999999',
    payloadHash: 'hash',
    certificateFingerprint: 'cert',
    certificateValid: true,
    revocationChecked: true,
  });
  await expect(verifyLegalSignature({ verify }, input)).rejects.toThrow(
    'SIGNATURE_INN_MISMATCH',
  );
  verify.mockResolvedValue({
    valid: true,
    signerInn: input.expectedInn,
    payloadHash: 'different',
    certificateFingerprint: 'cert',
    certificateValid: true,
    revocationChecked: true,
  });
  await expect(verifyLegalSignature({ verify }, input)).rejects.toThrow(
    'SIGNATURE_PAYLOAD_MISMATCH',
  );
  verify.mockResolvedValue({
    valid: true,
    signerInn: input.expectedInn,
    payloadHash: 'hash',
    certificateFingerprint: 'cert',
    certificateValid: true,
    revocationChecked: false,
  });
  await expect(verifyLegalSignature({ verify }, input)).rejects.toThrow(
    'SIGNATURE_INVALID',
  );
});
