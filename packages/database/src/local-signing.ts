import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { requirePipeline, type LocalSigningStore } from '@avito/domain';
import type { Database } from './client.js';
import type { PipelineProtection } from './marking-pipeline.js';
export function createLocalSigningStore(
  db: Database,
  protection: PipelineProtection | undefined,
): LocalSigningStore {
  return {
    async claim(input) {
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      return db.transaction(async (tx) => {
        const result = (
          await tx.execute<{
            id: string;
            document_id: string;
            document_type: string;
            seller_inn: string;
            payload_ciphertext: string;
            encryption_key_id: string;
            identity_hash: string;
            payload_hash: string;
            simulated: boolean;
          }>(
            sql`SELECT t.*,a.document_type,a.payload_ciphertext,a.encryption_key_id,a.identity_hash,a.payload_hash FROM marking_signing_tasks t JOIN marking_document_artifacts a ON a.document_id=t.document_id WHERE (t.status='PENDING' OR (t.status='LEASED' AND t.lease_expires_at<now())) AND (NOT t.simulated OR ${input.acceptSimulation}) ORDER BY t.created_at,t.id FOR UPDATE OF t SKIP LOCKED LIMIT 1`,
          )
        ).rows[0];
        if (!result) return null;
        const raw = protection.decrypt(
          result.payload_ciphertext,
          result.encryption_key_id,
          result.identity_hash,
        );
        const payloadHash = createHash('sha256').update(raw).digest('hex');
        requirePipeline(
          payloadHash === result.payload_hash,
          'SIGNATURE_PAYLOAD_MISMATCH',
        );
        const leaseId = randomUUID(),
          expiresAt = new Date(Date.now() + 60_000).toISOString();
        await tx.execute(
          sql`UPDATE marking_signing_tasks SET status='LEASED',signer_id=${input.signerId},lease_id=${leaseId},lease_expires_at=${expiresAt}::timestamptz WHERE id=${result.id}`,
        );
        return {
          taskId: result.id,
          leaseId,
          documentId: result.document_id,
          documentType: result.document_type,
          sellerInn: result.seller_inn,
          payloadBase64: Buffer.from(raw).toString('base64'),
          payloadHash,
          expiresAt,
          simulated: result.simulated,
          algorithm: 'GOST_CMS_DETACHED',
        };
      });
    },
    async receive(input) {
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      return db.transaction(async (tx) => {
        const task = (
          await tx.execute<{
            id: string;
            status: string;
            lease_id: string;
            signer_id: string;
            lease_expires_at: string | Date;
            payload_hash: string;
            signature_hash: string | null;
          }>(
            sql`SELECT t.*,a.payload_hash FROM marking_signing_tasks t JOIN marking_document_artifacts a ON a.document_id=t.document_id WHERE t.id=${input.taskId} FOR UPDATE OF t`,
          )
        ).rows[0];
        requirePipeline(task, 'ENTITY_NOT_FOUND');
        const signatureHash = createHash('sha256')
          .update(
            JSON.stringify({
              signature: input.signatureBase64,
              certificate: input.certificateBase64,
            }),
          )
          .digest('hex');
        requirePipeline(
          task.payload_hash === input.payloadHash,
          'SIGNATURE_PAYLOAD_MISMATCH',
        );
        requirePipeline(
          task.signer_id === input.signerId && task.lease_id === input.leaseId,
          'SIGNER_LEASE_MISMATCH',
        );
        if (task.status === 'RECEIVED') {
          requirePipeline(
            task.signature_hash === signatureHash,
            'IDEMPOTENCY_CONFLICT',
          );
          return {
            taskId: task.id,
            state: 'RECEIVED',
            verified: false,
            replayed: true,
          };
        }
        requirePipeline(
          task.status === 'LEASED' &&
            new Date(task.lease_expires_at).getTime() > Date.now(),
          'SIGNER_LEASE_EXPIRED',
        );
        const encrypted = protection.encrypt(
          JSON.stringify({
            signature: input.signatureBase64,
            certificate: input.certificateBase64,
          }),
          'signature:' + task.id,
        );
        await tx.execute(
          sql`UPDATE marking_signing_tasks SET status='RECEIVED',signature_ciphertext=${encrypted.payloadCiphertext},signature_key_id=${encrypted.encryptionKeyId},signature_identity_hash=${encrypted.identityHash},signature_hash=${signatureHash},received_at=now() WHERE id=${task.id}`,
        );
        // No real crypto verifier is configured: receiving bytes must never release a document for submission.
        await tx.execute(
          sql`INSERT INTO marking_issues(key,code,entity_id,details) VALUES(${'SIGNATURE_VERIFICATION_UNAVAILABLE:' + task.id},'SIGNATURE_VERIFICATION_UNAVAILABLE',${task.id},'{}'::jsonb) ON CONFLICT(key) DO NOTHING`,
        );
        return {
          taskId: task.id,
          state: 'RECEIVED',
          verified: false,
          replayed: false,
        };
      });
    },
  };
}
