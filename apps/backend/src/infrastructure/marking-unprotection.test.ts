import { randomBytes } from 'node:crypto';
import { it, expect } from 'vitest';
import {
  createMarkingProtector,
  createMarkingUnprotector,
} from './marking-protection.js';
it('round-trips exact GS bytes and authenticates key identity and ciphertext', () => {
  const key = randomBytes(32).toString('base64'),
    encrypt = createMarkingProtector(key, 'test'),
    decrypt = createMarkingUnprotector(key, 'test');
  const original =
      ']d2\u001d010466043076454321TEST000000001\u001d91ABCD\u001d92payload\r\n',
    stored = encrypt(original, 'identity');
  expect(decrypt(stored.payloadCiphertext, 'test', stored.identityHash)).toBe(
    original,
  );
  expect(() =>
    decrypt(stored.payloadCiphertext, 'other', stored.identityHash),
  ).toThrow();
  expect(() =>
    decrypt(stored.payloadCiphertext, 'test', '0'.repeat(64)),
  ).toThrow();
  const parts = stored.payloadCiphertext.split(':');
  parts[3] = randomBytes(32).toString('base64');
  expect(() => decrypt(parts.join(':'), 'test', stored.identityHash)).toThrow();
});
