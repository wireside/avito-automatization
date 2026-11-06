import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { requirePipeline, type LocalSigningStore } from '@avito/domain';
import type { Database } from './client.js';
import type { PipelineProtection } from './marking-pipeline.js';
export function createLocalSigningStore(
  db: Database,
  protection: PipelineProtection | undefined,
  expectedThumbprint: string | undefined,
  sellerInn?: string,
): LocalSigningStore {
  return {
    async claim(input) {
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      requirePipeline(expectedThumbprint, 'SIGNER_CERTIFICATE_NOT_CONFIGURED');
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`UPDATE signer_jobs j SET status='PENDING',expires_at=now()+interval '30 minutes' FROM chz_documents d WHERE j.document_id=d.id AND j.purpose='DOCUMENT' AND j.status IN ('PENDING','LEASED') AND j.expires_at<=now() AND d.status IN ('PREPARING','WAITING_SIGNATURE') AND d.submission_started_at IS NULL AND d.external_document_id IS NULL`,
        );
        const row = (
          await tx.execute<{
            id: string;
            document_id: string | null;
            purpose: 'AUTH' | 'DOCUMENT';
            document_type: string;
            seller_inn: string;
            payload_ciphertext: string;
            encryption_key_id: string;
            identity_hash: string;
            payload_hash: string;
          }>(
            sql`SELECT * FROM signer_jobs WHERE (status='PENDING' OR(status='LEASED' AND lease_expires_at<now())) AND expires_at>now() AND (${sellerInn ?? null}::text IS NULL OR seller_inn=${sellerInn ?? null}) ORDER BY CASE WHEN purpose='AUTH' THEN 0 ELSE 1 END,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
          )
        ).rows[0];
        if (!row) return null;
        const raw = protection.decrypt(
            row.payload_ciphertext,
            row.encryption_key_id,
            row.identity_hash,
          ),
          payloadHash = createHash('sha256').update(raw).digest('hex');
        requirePipeline(
          payloadHash === row.payload_hash,
          'SIGNATURE_PAYLOAD_MISMATCH',
        );
        const leaseId = randomUUID(),
          expiresAt = new Date(Date.now() + 120_000).toISOString();
        await tx.execute(
          sql`UPDATE signer_jobs SET status='LEASED',signer_id=${input.signerId},lease_id=${leaseId},lease_expires_at=${expiresAt}::timestamptz WHERE id=${row.id}`,
        );
        return {
          taskId: row.id,
          leaseId,
          documentId: row.document_id,
          purpose: row.purpose,
          documentType: row.document_type,
          sellerInn: row.seller_inn,
          payloadBase64: Buffer.from(raw).toString('base64'),
          payloadHash,
          expiresAt,
          algorithm:
            row.purpose === 'AUTH' ? 'GOST_CMS_ATTACHED' : 'GOST_CMS_DETACHED',
        };
      });
    },
    async receive(input) {
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      requirePipeline(expectedThumbprint, 'SIGNER_CERTIFICATE_NOT_CONFIGURED');
      return db.transaction(async (tx) => {
        const task = (
          await tx.execute<{
            id: string;
            document_id: string | null;
            status: string;
            signer_id: string;
            lease_id: string;
            lease_expires_at: string;
            expires_at: string;
            payload_hash: string;
            seller_inn: string;
            signature_hash: string | null;
          }>(sql`SELECT * FROM signer_jobs WHERE id=${input.taskId} FOR UPDATE`)
        ).rows[0];
        requirePipeline(task, 'ENTITY_NOT_FOUND');
        requirePipeline(
          !sellerInn || task.seller_inn === sellerInn,
          'SIGNATURE_INN_MISMATCH',
        );
        requirePipeline(
          task.payload_hash === input.payloadHash &&
            input.verification.payloadHash === task.payload_hash,
          'SIGNATURE_PAYLOAD_MISMATCH',
        );
        requirePipeline(
          task.lease_id === input.leaseId && task.signer_id === input.signerId,
          'SIGNER_LEASE_MISMATCH',
        );
        requirePipeline(
          input.verification.valid &&
            input.verification.chainValid &&
            input.verification.revocationChecked,
          'SIGNATURE_INVALID',
        );
        requirePipeline(
          input.verification.signerInn === task.seller_inn,
          'SIGNATURE_INN_MISMATCH',
        );
        const cert = new X509Certificate(
          Buffer.from(input.certificateBase64, 'base64'),
        );
        requirePipeline(
          cert.fingerprint.replaceAll(':', '').toUpperCase() ===
            expectedThumbprint.replaceAll(':', '').toUpperCase(),
          'SIGNER_CERTIFICATE_MISMATCH',
        );
        requirePipeline(
          Date.parse(cert.validFrom) <= Date.now() &&
            Date.parse(cert.validTo) > Date.now(),
          'SIGNER_CERTIFICATE_EXPIRED',
        );
        const envelope = JSON.stringify({
            signatureBase64: input.signatureBase64,
            certificateBase64: input.certificateBase64,
          }),
          signatureHash = createHash('sha256').update(envelope).digest('hex');
        if (task.status === 'VERIFIED') {
          requirePipeline(
            task.signature_hash === signatureHash,
            'IDEMPOTENCY_CONFLICT',
          );
          return {
            taskId: task.id,
            state: 'VERIFIED',
            verified: true,
            replayed: true,
          };
        }
        requirePipeline(
          task.status === 'LEASED' &&
            Date.parse(task.lease_expires_at) > Date.now() &&
            Date.parse(task.expires_at) > Date.now(),
          'SIGNER_LEASE_EXPIRED',
        );
        const encrypted = protection.encrypt(envelope, 'signature:' + task.id);
        await tx.execute(
          sql`UPDATE signer_jobs SET status='VERIFIED',signature_ciphertext=${encrypted.payloadCiphertext},signature_key_id=${encrypted.encryptionKeyId},signature_identity_hash=${encrypted.identityHash},signature_hash=${signatureHash},certificate_thumbprint=${expectedThumbprint},verified_at=now() WHERE id=${task.id}`,
        );
        if (task.document_id)
          await tx.execute(
            sql`INSERT INTO integration_operations(operation_type,idempotency_key,aggregate_type,aggregate_id,correlation_id) VALUES('pipeline.document',${'signed:' + task.id},'marking-pipeline',${task.document_id},${randomUUID()}) ON CONFLICT(idempotency_key) DO NOTHING`,
          );
        return {
          taskId: task.id,
          state: 'VERIFIED',
          verified: true,
          replayed: false,
        };
      });
    },
    async heartbeat(input) {
      requirePipeline(
        expectedThumbprint &&
          input.certificateThumbprint.toUpperCase() ===
            expectedThumbprint.replaceAll(':', '').toUpperCase(),
        'SIGNER_CERTIFICATE_MISMATCH',
      );
      await db.execute(
        sql`INSERT INTO signer_devices(signer_id,certificate_thumbprint,certificate_expires_at,ready,error_code,last_seen_at) VALUES(${input.signerId},${input.certificateThumbprint},${input.certificateExpiresAt}::timestamptz,${input.ready},${input.errorCode ?? null},now()) ON CONFLICT(signer_id) DO UPDATE SET certificate_thumbprint=excluded.certificate_thumbprint,certificate_expires_at=excluded.certificate_expires_at,ready=excluded.ready,error_code=excluded.error_code,last_seen_at=now()`,
      );
    },
  };
}
