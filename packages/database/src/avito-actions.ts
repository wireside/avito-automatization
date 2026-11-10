import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  requirePipeline,
  type AvitoActionStore,
  type AvitoActionCommand,
  type AvitoActionWork,
  type AvitoActionView,
} from '@avito/domain';
import type { Database } from './client.js';
import type { PipelineProtection } from './marking-pipeline.js';
export function createAvitoActionStore(
  db: Database,
  protection: PipelineProtection | undefined,
  accountId: string,
): AvitoActionStore {
  const fingerprint = (orderId: string, command: AvitoActionCommand) =>
    createHash('sha256')
      .update(
        JSON.stringify({
          accountId,
          orderId,
          action: command.action,
          data: Object.fromEntries(
            Object.entries(command.data).sort(([a], [b]) => a.localeCompare(b)),
          ),
        }),
      )
      .digest('hex');
  return {
    async enqueue(orderId, command, actorId) {
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${accountId + ':' + orderId},0))`,
        );
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${actorId + ':' + command.requestId},1))`,
        );
        const existing = (
          await tx.execute<{ id: string; fingerprint: string }>(
            sql`SELECT id,fingerprint FROM avito_order_actions WHERE actor_id=${actorId} AND request_id=${command.requestId}`,
          )
        ).rows[0];
        const hash = fingerprint(orderId, command);
        if (existing) {
          requirePipeline(
            existing.fingerprint === hash,
            'IDEMPOTENCY_CONFLICT',
          );
          return { operationId: existing.id, replayed: true };
        }
        const pending = (
          await tx.execute(
            sql`SELECT a.id FROM avito_order_actions a JOIN integration_operations o ON o.id=a.id WHERE a.account_id=${accountId} AND a.order_id=${orderId} AND (o.status IN ('PENDING','RUNNING','RETRY_SCHEDULED') OR (a.started_at IS NOT NULL AND a.result IS NULL AND o.status='MANUAL_ATTENTION')) LIMIT 1`,
          )
        ).rows;
        requirePipeline(pending.length === 0, 'ORDER_ACTION_PENDING');
        const id = randomUUID(),
          enc = protection.encrypt(
            JSON.stringify(command),
            'avito-action:' + id,
          );
        await tx.execute(
          sql`INSERT INTO integration_operations(id,operation_type,idempotency_key,aggregate_type,aggregate_id,correlation_id) VALUES(${id},'avito.order-action',${'avito-action:' + id},'avito-order',${accountId + ':' + orderId},${command.requestId})`,
        );
        await tx.execute(
          sql`INSERT INTO avito_order_actions(id,account_id,order_id,action,actor_id,request_id,fingerprint,payload_ciphertext,encryption_key_id,identity_hash) VALUES(${id},${accountId},${orderId},${command.action},${actorId},${command.requestId},${hash},${enc.payloadCiphertext},${enc.encryptionKeyId},${enc.identityHash})`,
        );
        await tx.execute(
          sql`INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,source,correlation_id,metadata) VALUES('USER',${actorId},'AVITO_ORDER_ACTION_REQUESTED','avito-order',${orderId},'MINI_APP',${command.requestId},${JSON.stringify({ action: command.action, operationId: id })}::jsonb)`,
        );
        return { operationId: id, replayed: false };
      });
    },
    async list(orderId) {
      const rows = (
        await db.execute<{
          id: string;
          action: AvitoActionView['action'];
          status: string;
          error_code: string | null;
          created_at: Date;
          result: { labelTaskId?: string } | null;
          started_at: Date | null;
        }>(
          sql`SELECT a.id,a.action,o.status,o.last_error_code AS error_code,a.created_at,a.result,a.started_at FROM avito_order_actions a JOIN integration_operations o ON o.id=a.id WHERE a.account_id=${accountId} AND a.order_id=${orderId} ORDER BY a.created_at DESC LIMIT 20`,
        )
      ).rows;
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        status: r.status,
        errorCode: r.error_code,
        createdAt: new Date(r.created_at).toISOString(),
        labelReady: !!r.result?.labelTaskId,
        reconcilable:
          !!r.started_at &&
          r.result === null &&
          r.status === 'MANUAL_ATTENTION',
      }));
    },
    async load(id) {
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      const r = (
        await db.execute<{
          id: string;
          order_id: string;
          payload_ciphertext: string;
          encryption_key_id: string;
          identity_hash: string;
          started_at: Date | null;
          result: AvitoActionWork['result'];
        }>(
          sql`SELECT * FROM avito_order_actions WHERE id=${id} AND account_id=${accountId}`,
        )
      ).rows[0];
      requirePipeline(r, 'ORDER_NOT_FOUND');
      return {
        id: r.id,
        orderId: r.order_id,
        command: JSON.parse(
          protection.decrypt(
            r.payload_ciphertext,
            r.encryption_key_id,
            r.identity_hash,
          ),
        ) as AvitoActionCommand,
        started: !!r.started_at,
        result: r.result,
      };
    },
    async start(id) {
      const r = await db.execute(
        sql`UPDATE avito_order_actions SET started_at=now() WHERE id=${id} AND account_id=${accountId} AND started_at IS NULL RETURNING id`,
      );
      requirePipeline(r.rows.length === 1, 'AVITO_ACTION_RESULT_UNKNOWN');
    },
    async reset(id) {
      await db.execute(
        sql`UPDATE avito_order_actions SET started_at=NULL WHERE id=${id} AND account_id=${accountId} AND result IS NULL`,
      );
    },
    async reconcile(id, orderId) {
      await db.transaction(async (tx) => {
        const row = (
          await tx.execute<{ id: string }>(
            sql`SELECT a.id FROM avito_order_actions a JOIN integration_operations o ON o.id=a.id WHERE a.id=${id} AND a.account_id=${accountId} AND a.order_id=${orderId} AND a.started_at IS NOT NULL AND a.result IS NULL AND o.status='MANUAL_ATTENTION' AND o.attempt_count<20 FOR UPDATE OF a,o`,
          )
        ).rows[0];
        requirePipeline(row, 'ORDER_ACTION_UNAVAILABLE');
        await tx.execute(
          sql`UPDATE integration_operations SET status='PENDING',max_attempts=greatest(max_attempts,attempt_count+1),next_attempt_at=NULL,updated_at=now() WHERE id=${id}`,
        );
      });
    },
    async finish(id, result) {
      await db.execute(
        sql`UPDATE avito_order_actions SET result=${JSON.stringify(result)}::jsonb WHERE id=${id} AND account_id=${accountId} AND result IS NULL`,
      );
    },
  };
}
