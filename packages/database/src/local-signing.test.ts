import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabaseClient } from './client.js';
import { createChzSessionStore } from './chz-session.js';
import { createLocalSigningStore } from './local-signing.js';
const url =
  process.env.RUN_MARKING_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
const publicCertificate = `-----BEGIN CERTIFICATE-----
MIIDNTCCAh2gAwIBAgIUOEZ0KT1UWcsT2BxKMZTwGc0GrVgwDQYJKoZIhvcNAQEL
BQAwKTEnMCUGA1UEAwweTG9jYWwgc2lnbmluZyBwcm90b2NvbCBmaXh0dXJlMCAX
DTI2MTEwNjExNTMxNVoYDzIxMjYxMDEzMTE1MzE1WjApMScwJQYDVQQDDB5Mb2Nh
bCBzaWduaW5nIHByb3RvY29sIGZpeHR1cmUwggEiMA0GCSqGSIb3DQEBAQUAA4IB
DwAwggEKAoIBAQDQAeLG0Vs8ZBkqjneQePH+zaXFRZ/49Vs6JtyHy2U/rm+2sca+
tKCEJ/WakH0G+JkoKtXCRyAlDyK25IVzYmkPg2/iZsPphRYb37txnuqtoh/aSnBy
H8qVw0hv6TN4q0Or3ABQPmizusw6+LOxkbR2/SREJ68f3DMzC6jIe2VD10At0MBG
XJiRS4c7VbjMYfLqLMJh0YZuQ4z4XBRkA+mzU4F/rMX8USvdAUed6XF+/by1RAKS
q3cuJTiwQrEFmZi4O8qAPwpWwlLyEc98mAENkCA8hJ34ygrDuVyDFA0CdK3bWJGh
zeJMnuXqrhcd+xIZggTh0O2OLRAnCS3gUBOXAgMBAAGjUzBRMB0GA1UdDgQWBBT1
2Ax78toQy0jAiz4KP9t0bskE3jAfBgNVHSMEGDAWgBT12Ax78toQy0jAiz4KP9t0
bskE3jAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQC4gekY4/Iv
p5bnQP+lAtkD2l3piZrRFvV/LROGFg/4i1ltr0T/ub/aTrb+cxDLaupH01QnY8VJ
tI7ZlAWFPa03Q8zygCDU+01GA11dsiX8OzbODIFurKXXY+a6XiLrYrdTYj62k/+k
Qzj5Tzjm0WvzgwFntCE4ur3ODh+vWYHb9UvNHHeETTivpvnyGHD0GrUWAD0jTkEP
HkZku1Voy1cAnh2dJw5XcI+4vt1SJeh/fiGYbqfngmYz4toUjgbvK+KuL6YfqFX0
9ROB/X8bnLMXCRSGAQbCrTH7OgU04mdpGucOGar2vcXyPTLT/mnrK9TNM9G/79OZ
AlGio+Zxm+yT
-----END CERTIFICATE-----
`;
(url ? describe : describe.skip)(
  'managed signing protocol with PostgreSQL',
  () => {
    const db = createDatabaseClient(url ?? 'postgresql://unused'),
      values = new Map<string, string>();
    const protection = {
      encrypt: (raw: string, identity: string) => {
        const id = randomUUID();
        values.set(id, raw);
        return {
          identityHash: createHash('sha256').update(identity).digest('hex'),
          inputFingerprint: createHash('sha256').update(raw).digest('hex'),
          payloadCiphertext: id,
          encryptionKeyId: 'fixture',
        };
      },
      decrypt: (id: string) => {
        const raw = values.get(id);
        if (raw === undefined) throw Error('missing fixture');
        return raw;
      },
    };
    const cert = new X509Certificate(publicCertificate),
      pin = cert.fingerprint.replaceAll(':', ''),
      sessions = createChzSessionStore(db.db, protection),
      signer = createLocalSigningStore(db.db, protection, pin);
    afterAll(() => db.pool.end());
    it('leases exact AUTH bytes, pins the certificate, checks nonce and accepts only identical replay', async () => {
      await sessions.challenge(
        '123456789012',
        randomUUID(),
        'challenge\nexact bytes',
      );
      const lease = await signer.claim({ signerId: 'WINDOWS' });
      expect(lease).toMatchObject({
        purpose: 'AUTH',
        algorithm: 'GOST_CMS_ATTACHED',
      });
      expect(Buffer.from(lease!.payloadBase64, 'base64').toString()).toBe(
        'challenge\nexact bytes',
      );
      const input = {
        taskId: lease!.taskId,
        leaseId: lease!.leaseId,
        signerId: 'WINDOWS',
        payloadHash: lease!.payloadHash,
        signatureBase64: Buffer.from('trusted-agent-protocol-fixture').toString(
          'base64',
        ),
        certificateBase64: cert.raw.toString('base64'),
        verification: {
          valid: true,
          chainValid: true,
          revocationChecked: true,
          signerInn: '123456789012',
          payloadHash: lease!.payloadHash,
        },
      };
      await expect(
        signer.receive({ ...input, leaseId: randomUUID() }),
      ).rejects.toThrow('SIGNER_LEASE_MISMATCH');
      await expect(
        createLocalSigningStore(db.db, protection, '0'.repeat(40)).receive(
          input,
        ),
      ).rejects.toThrow('SIGNER_CERTIFICATE_MISMATCH');
      expect(await signer.receive(input)).toMatchObject({
        verified: true,
        replayed: false,
      });
      expect(await signer.receive(input)).toMatchObject({
        verified: true,
        replayed: true,
      });
      await expect(
        signer.receive({ ...input, signatureBase64: 'different' }),
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      await sessions.save(
        lease!.taskId,
        '123456789012',
        'encrypted-session',
        new Date(Date.now() + 3600000).toISOString(),
      );
      expect(await sessions.getToken()).toBe('encrypted-session');
      await sessions.invalidate();
      expect(await sessions.getToken()).toBeNull();
    });
    it('does not report unpinned devices as ready', async () => {
      await expect(
        signer.heartbeat({
          signerId: 'OTHER',
          certificateThumbprint: '0'.repeat(40),
          certificateExpiresAt: cert.validTo,
          ready: true,
        }),
      ).rejects.toThrow('SIGNER_CERTIFICATE_MISMATCH');
      await signer.heartbeat({
        signerId: 'WINDOWS',
        certificateThumbprint: pin,
        certificateExpiresAt: cert.validTo,
        ready: true,
      });
      expect(
        (
          await db.db.execute(
            sql`SELECT ready FROM signer_devices WHERE signer_id='WINDOWS'`,
          )
        ).rows[0]!.ready,
      ).toBe(true);
    });
  },
);
