import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connectedSellerInn } from './warehouses.js';
import { sql } from 'drizzle-orm';
import {
  requirePipeline,
  type SignerEnrollmentStore,
  type SignerCandidate,
} from '@avito/domain';
import type { Database } from './client.js';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
async function owner(tx: Tx, id: string) {
  requirePipeline(
    (
      await tx.execute(
        sql`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=${id} AND u.is_active AND r.name='OWNER'`,
      )
    ).rows.length > 0,
    'FORBIDDEN',
  );
}
async function audit(tx: Tx, id: string, action: string, entity: string) {
  await tx.execute(
    sql`INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,source,metadata,correlation_id) VALUES('USER',${id},${action},'signer_installation',${entity},'signer-enrollment','{}'::jsonb,${randomUUID()})`,
  );
}
interface CandidateRow extends Record<string, unknown> {
  id: string;
  signer_id: string;
  seller_inn: string;
  certificate_thumbprint: string;
  certificate_expires_at: Date | string;
  status: string;
  pairing_code: string;
}
const candidate = (r: CandidateRow): SignerCandidate => ({
  id: r.id,
  signerId: r.signer_id,
  sellerInn: r.seller_inn,
  certificateThumbprint: r.certificate_thumbprint,
  certificateExpiresAt: new Date(r.certificate_expires_at).toISOString(),
  status: r.status,
  pairingCode: r.pairing_code,
});
export function createSignerEnrollmentStore(
  db: Database,
): SignerEnrollmentStore {
  return {
    async createTicket(ownerId) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378042)`);
        await owner(tx, ownerId);
        requirePipeline(
          !(
            await tx.execute(
              sql`SELECT id FROM signer_enrollments WHERE owner_id=${ownerId} AND created_at>now()-interval '10 seconds'`,
            )
          ).rows.length,
          'INSTALL_LINK_RATE_LIMITED',
        );
        await tx.execute(
          sql`UPDATE signer_enrollments SET invalidated_at=now() WHERE owner_id=${ownerId} AND consumed_at IS NULL AND invalidated_at IS NULL`,
        );
        const ticket = randomBytes(32).toString('base64url'),
          id = randomUUID(),
          expiresAt = new Date(Date.now() + 30 * 60000).toISOString();
        await tx.execute(
          sql`INSERT INTO signer_enrollments(id,owner_id,token_hash,expires_at) VALUES(${id},${ownerId},${hash(ticket)},${expiresAt}::timestamptz)`,
        );
        await audit(tx, ownerId, 'signer.install_link', id);
        return { ticket, expiresAt };
      });
    },
    async validTicket(ticket) {
      return (
        (
          await db.execute(
            sql`SELECT e.id FROM signer_enrollments e JOIN users u ON u.id=e.owner_id WHERE e.token_hash=${hash(ticket)} AND e.expires_at>now() AND e.invalidated_at IS NULL AND u.is_active AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='OWNER')`,
          )
        ).rows.length > 0
      );
    },
    async register(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378042)`);
        const e = (
          await tx.execute<{
            id: string;
            owner_id: string;
            consumed_at: unknown;
          }>(
            sql`SELECT * FROM signer_enrollments WHERE token_hash=${hash(input.ticket)} AND expires_at>now() AND invalidated_at IS NULL FOR UPDATE`,
          )
        ).rows[0];
        requirePipeline(e, 'INSTALL_LINK_EXPIRED');
        await owner(tx, e.owner_id);
        if (e.consumed_at) {
          const prev = (
            await tx.execute<{ id: string; status: string }>(
              sql`SELECT id,status FROM signer_installations WHERE enrollment_id=${e.id} AND device_token_hash=${input.deviceTokenHash} AND signer_id=${input.signerId} AND certificate_thumbprint=${input.certificateThumbprint}`,
            )
          ).rows[0];
          requirePipeline(prev, 'INSTALL_LINK_USED');
          return prev;
        }
        const configured = (
          await tx.execute<{ seller_inn: string }>(
            sql`SELECT ${connectedSellerInn} AS seller_inn`,
          )
        ).rows[0];
        requirePipeline(
          !configured?.seller_inn || configured.seller_inn === input.sellerInn,
          'SIGNATURE_INN_MISMATCH',
        );
        const id = randomUUID();
        await tx.execute(
          sql`INSERT INTO signer_installations(id,enrollment_id,owner_id,signer_id,seller_inn,certificate_thumbprint,certificate_expires_at,device_token_hash,pairing_code) VALUES(${id},${e.id},${e.owner_id},${input.signerId},${input.sellerInn},${input.certificateThumbprint},${input.certificateExpiresAt}::timestamptz,${input.deviceTokenHash},${input.pairingCode})`,
        );
        await tx.execute(
          sql`UPDATE signer_enrollments SET consumed_at=now() WHERE id=${e.id}`,
        );
        await tx.execute(
          sql`INSERT INTO integration_operations(operation_type,idempotency_key,aggregate_type,aggregate_id,correlation_id) VALUES('signer.notify',${'signer-notify:' + id},'signer',${id},${randomUUID()})`,
        );
        await audit(tx, e.owner_id, 'signer.register', id);
        return { id, status: 'PENDING' };
      });
    },
    async decide(ownerId, id, approve) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378042)`);
        await owner(tx, ownerId);
        const d = (
          await tx.execute<CandidateRow & { expires_at: Date | string }>(
            sql`SELECT i.*,e.expires_at FROM signer_installations i JOIN signer_enrollments e ON e.id=i.enrollment_id WHERE i.id=${id} AND i.owner_id=${ownerId} FOR UPDATE OF i`,
          )
        ).rows[0];
        requirePipeline(d, 'ENTITY_NOT_FOUND');
        if (
          (approve && d.status === 'ACTIVE') ||
          (!approve && d.status === 'REJECTED')
        )
          return;
        requirePipeline(
          d.status === 'PENDING' &&
            new Date(d.expires_at).getTime() > Date.now(),
          'INSTALL_LINK_EXPIRED',
        );
        if (approve) {
          requirePipeline(
            new Date(d.certificate_expires_at).getTime() > Date.now(),
            'SIGNER_CERTIFICATE_EXPIRED',
          );
          const cfg = (
            await tx.execute<{ seller_inn: string }>(
              sql`SELECT ${connectedSellerInn} AS seller_inn`,
            )
          ).rows[0];
          requirePipeline(
            !cfg?.seller_inn || cfg.seller_inn === d.seller_inn,
            'SIGNATURE_INN_MISMATCH',
          );
          await tx.execute(
            sql`UPDATE signer_installations SET status='REVOKED' WHERE status='ACTIVE'`,
          );
          await tx.execute(sql`UPDATE signer_devices SET ready=false`);
          await tx.execute(sql`UPDATE chz_sessions SET expires_at=now()`);
          await tx.execute(
            sql`UPDATE signer_jobs SET status='EXPIRED' WHERE purpose='AUTH' AND status IN ('PENDING','LEASED','VERIFIED')`,
          );
        }
        await tx.execute(
          sql`UPDATE signer_installations SET status=${approve ? 'ACTIVE' : 'REJECTED'},approved_at=${approve ? new Date() : null}::timestamptz WHERE id=${id}`,
        );
        await audit(
          tx,
          ownerId,
          approve ? 'signer.approve' : 'signer.reject',
          id,
        );
      });
    },
    async list(ownerId) {
      return (
        await db.execute<CandidateRow>(
          sql`SELECT i.* FROM signer_installations i JOIN signer_enrollments e ON e.id=i.enrollment_id WHERE i.owner_id=${ownerId} AND (i.status='ACTIVE' OR(i.status='PENDING' AND e.expires_at>now())) ORDER BY i.created_at DESC LIMIT 10`,
        )
      ).rows.map(candidate);
    },
    async binding(token) {
      const r = (
        await db.execute<CandidateRow>(
          sql`SELECT i.* FROM signer_installations i JOIN users u ON u.id=i.owner_id WHERE i.device_token_hash=${hash(token)} AND i.status='ACTIVE' AND i.certificate_expires_at>now() AND u.is_active AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='OWNER')`,
        )
      ).rows[0];
      return r
        ? {
            signerId: r.signer_id,
            sellerInn: r.seller_inn,
            certificateThumbprint: r.certificate_thumbprint,
          }
        : null;
    },
    async status(token) {
      const r = (
        await db.execute<{ status: string; expires_at: Date | string }>(
          sql`SELECT i.status,e.expires_at FROM signer_installations i JOIN signer_enrollments e ON e.id=i.enrollment_id WHERE i.device_token_hash=${hash(token)}`,
        )
      ).rows[0];
      requirePipeline(r, 'UNAUTHORIZED');
      return {
        status:
          r.status === 'PENDING' &&
          new Date(r.expires_at).getTime() <= Date.now()
            ? 'EXPIRED'
            : r.status,
      };
    },
    async hasActive() {
      return (
        (
          await db.execute(
            sql`SELECT i.id FROM signer_installations i JOIN users u ON u.id=i.owner_id WHERE i.status='ACTIVE' AND i.certificate_expires_at>now() AND u.is_active AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='OWNER') LIMIT 1`,
          )
        ).rows.length > 0
      );
    },
    async notification(id) {
      const r = (
        await db.execute<CandidateRow & { telegram_id: string }>(
          sql`SELECT i.*,u.telegram_id FROM signer_installations i JOIN users u ON u.id=i.owner_id JOIN signer_enrollments e ON e.id=i.enrollment_id JOIN integration_operations io ON io.aggregate_id=i.id::text AND io.operation_type='signer.notify' WHERE io.id=${id} AND i.status='PENDING' AND e.expires_at>now() AND i.notification_message_id IS NULL AND u.is_active AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='OWNER')`,
        )
      ).rows[0];
      return r ? { ...candidate(r), telegramId: r.telegram_id } : null;
    },
    async notified(id, messageId) {
      await db.execute(
        sql`UPDATE signer_installations SET notification_message_id=${messageId} WHERE id=${id}`,
      );
    },
  };
}
