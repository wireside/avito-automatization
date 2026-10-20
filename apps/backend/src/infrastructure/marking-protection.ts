import { createCipheriv, createHash, randomBytes } from 'node:crypto';

export function createMarkingProtector(
  keyBase64: string,
  encryptionKeyId: string,
) {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32 || key.toString('base64') !== keyBase64)
    throw new Error(
      'MARKING_ENCRYPTION_KEY must be 32 bytes in canonical base64',
    );
  return (raw: string, identity: string) => {
    const identityHash = createHash('sha256')
      .update(identity, 'utf8')
      .digest('hex');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`marking:v1:${encryptionKeyId}:${identityHash}`));
    const ciphertext = Buffer.concat([
      cipher.update(raw, 'utf8'),
      cipher.final(),
    ]);
    return {
      identityHash,
      inputFingerprint: createHash('sha256').update(raw, 'utf8').digest('hex'),
      encryptionKeyId,
      payloadCiphertext: [
        'v1',
        nonce.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        ciphertext.toString('base64'),
      ].join(':'),
    };
  };
}
