import { createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMarkingProtector } from './marking-protection.js';
describe('encrypted marking storage', () => {
  it('roundtrips original GS and transport bytes with authenticated encryption', () => {
    const key = randomBytes(32);
    const raw = ']d201synthetic\u001d91test\r\n';
    const protect = createMarkingProtector(key.toString('base64'), 'test-v1');
    const first = protect(raw, 'synthetic-identity');
    const second = protect(raw, 'synthetic-identity');
    expect(first.payloadCiphertext).not.toBe(second.payloadCiphertext);
    expect(first.identityHash).toBe(second.identityHash);
    expect(first.payloadCiphertext).not.toContain(raw);
    const [, nonce, tag, ciphertext] = first.payloadCiphertext.split(':');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(nonce!, 'base64'),
    );
    cipher.setAAD(Buffer.from(`marking:v1:test-v1:${first.identityHash}`));
    cipher.setAuthTag(Buffer.from(tag!, 'base64'));
    expect(
      Buffer.concat([
        cipher.update(Buffer.from(ciphertext!, 'base64')),
        cipher.final(),
      ]).toString('utf8'),
    ).toBe(raw);
  });
  it('rejects malformed keys', () => {
    expect(() => createMarkingProtector('invalid', 'test')).toThrow();
  });
});
