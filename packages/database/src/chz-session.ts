import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { requirePipeline } from '@avito/domain';
import type { Database } from './client.js';
import type { PipelineProtection } from './marking-pipeline.js';
export function createChzSessionStore(
  db: Database,
  protection: PipelineProtection | undefined,
) {
  return {
    async getToken() {
      if (!protection) return null;
      const r = (
        await db.execute<{
          ciphertext: string;
          key_id: string;
          identity_hash: string;
        }>(
          sql`SELECT * FROM chz_sessions WHERE expires_at>now()+interval '2 minutes' ORDER BY expires_at DESC LIMIT 1`,
        )
      ).rows[0];
      return r
        ? protection.decrypt(r.ciphertext, r.key_id, r.identity_hash)
        : null;
    },
    async invalidate() {
      await db.execute(sql`UPDATE chz_sessions SET expires_at=now()`);
    },
    async sellerInn() {
      return (
        (
          await db.execute<{ seller_inn: string }>(
            sql`SELECT seller_inn FROM marking_pipeline_settings ORDER BY warehouse_id LIMIT 1`,
          )
        ).rows[0]?.seller_inn ?? null
      );
    },
    async pending() {
      await db.execute(
        sql`UPDATE signer_jobs SET status='EXPIRED' WHERE purpose='AUTH' AND status IN ('PENDING','LEASED','VERIFIED') AND expires_at<=now()`,
      );
      return (
        (
          await db.execute<{
            id: string;
            auth_uuid: string;
            seller_inn: string;
            status: string;
            signature_ciphertext: string | null;
            signature_key_id: string | null;
            signature_identity_hash: string | null;
          }>(
            sql`SELECT * FROM signer_jobs WHERE purpose='AUTH' AND status IN ('PENDING','LEASED','VERIFIED') AND expires_at>now() ORDER BY created_at DESC LIMIT 1`,
          )
        ).rows[0] ?? null
      );
    },
    async challenge(inn: string, uuid: string, data: string) {
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      const id = randomUUID(),
        encrypted = protection.encrypt(data, 'auth:' + id);
      await db.execute(
        sql`INSERT INTO signer_jobs(id,purpose,document_type,seller_inn,auth_uuid,payload_ciphertext,encryption_key_id,identity_hash,payload_hash,expires_at) VALUES(${id},'AUTH','CHZ_AUTH',${inn},${uuid},${encrypted.payloadCiphertext},${encrypted.encryptionKeyId},${encrypted.identityHash},${createHash('sha256').update(data).digest('hex')},now()+interval '5 minutes')`,
      );
    },
    signature(row: {
      signature_ciphertext: string | null;
      signature_key_id: string | null;
      signature_identity_hash: string | null;
    }) {
      requirePipeline(
        protection &&
          row.signature_ciphertext &&
          row.signature_key_id &&
          row.signature_identity_hash,
        'SIGNER_WAITING',
      );
      return JSON.parse(
        protection.decrypt(
          row.signature_ciphertext,
          row.signature_key_id,
          row.signature_identity_hash,
        ),
      ) as { signatureBase64: string };
    },
    async save(jobId: string, inn: string, token: string, expiresAt: string) {
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      const encrypted = protection.encrypt(token, 'chz-session:' + inn);
      requirePipeline(Date.parse(expiresAt) > Date.now(), 'CHZ_AUTH_EXPIRED');
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`INSERT INTO chz_sessions(seller_inn,ciphertext,key_id,identity_hash,expires_at) VALUES(${inn},${encrypted.payloadCiphertext},${encrypted.encryptionKeyId},${encrypted.identityHash},${new Date(Math.min(Date.parse(expiresAt), Date.now() + 10 * 3600_000))}::timestamptz) ON CONFLICT(seller_inn) DO UPDATE SET ciphertext=excluded.ciphertext,key_id=excluded.key_id,identity_hash=excluded.identity_hash,expires_at=excluded.expires_at`,
        );
        await tx.execute(
          sql`UPDATE signer_jobs SET status='COMPLETED' WHERE id=${jobId}`,
        );
      });
    },
  };
}
