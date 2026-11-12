import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  requirePipeline,
  type WarehouseSave,
  type WarehouseSettingsStore,
} from '@avito/domain';
import type { Database } from './client.js';

// Also works immediately after the owner approves a Windows installation.
export const connectedSellerInn = sql`coalesce((SELECT seller_inn FROM chz_connection_settings WHERE id=1),(SELECT seller_inn FROM signer_installations WHERE status='ACTIVE' LIMIT 1))`;
const fingerprint = (input: WarehouseSave) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        'warehouse-settings',
        input.warehouseId ?? null,
        input.name,
        input.fiasId,
      ]),
    )
    .digest('hex');

export function createWarehouseSettingsStore(
  db: Database,
): WarehouseSettingsStore {
  type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
  async function replay(
    tx: Database | Tx,
    input: WarehouseSave,
    actorId: string,
  ) {
    const r = (
      await tx.execute<{
        fingerprint: string;
        result: { warehouseId: string };
      }>(
        sql`SELECT fingerprint,result FROM marking_command_results WHERE actor_id=${actorId} AND request_id=${input.requestId}`,
      )
    ).rows[0];
    if (!r) return null;
    requirePipeline(
      r.fingerprint === fingerprint(input),
      'IDEMPOTENCY_CONFLICT',
    );
    return r.result;
  }
  return {
    async list() {
      return (
        await db.execute<{
          id: string;
          name: string;
          isDefault: boolean;
          address: string | null;
          configured: boolean;
        }>(
          sql`SELECT w.id,w.name,w.code='MAIN' AS "isDefault",s.address,s.warehouse_id IS NOT NULL AS configured FROM warehouses w LEFT JOIN marking_pipeline_settings s ON s.warehouse_id=w.id WHERE w.archived_at IS NULL ORDER BY (w.code='MAIN') DESC,w.created_at,w.id`,
        )
      ).rows;
    },
    async connection() {
      return (
        await db.execute<{
          sellerInn: string | null;
          canChangeInn: boolean;
          signerActive: boolean;
          authorized: boolean;
        }>(
          sql`SELECT ${connectedSellerInn} AS "sellerInn",(NOT EXISTS(SELECT 1 FROM signer_installations WHERE status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM marking_pipeline_settings)) AS "canChangeInn",EXISTS(SELECT 1 FROM signer_installations WHERE status='ACTIVE' AND certificate_expires_at>now() AND seller_inn=${connectedSellerInn}) AS "signerActive",EXISTS(SELECT 1 FROM chz_sessions WHERE seller_inn=${connectedSellerInn} AND expires_at>now()+interval '2 minutes') AS authorized`,
        )
      ).rows[0]!;
    },
    async connect(inn, actorId) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378041)`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378042)`);
        const mismatches = (
          await tx.execute(
            sql`SELECT seller_inn FROM signer_installations WHERE status='ACTIVE' AND seller_inn<>${inn} UNION ALL SELECT seller_inn FROM marking_pipeline_settings WHERE seller_inn<>${inn}`,
          )
        ).rows;
        requirePipeline(!mismatches.length, 'SELLER_ACCOUNT_MISMATCH');
        // An unbound account may be corrected; invalidate any authorization work for the former INN.
        await tx.execute(
          sql`UPDATE signer_jobs SET status='EXPIRED' WHERE purpose='AUTH' AND seller_inn<>${inn} AND status IN ('PENDING','LEASED','VERIFIED')`,
        );
        await tx.execute(
          sql`UPDATE chz_sessions SET expires_at=now() WHERE seller_inn<>${inn}`,
        );
        await tx.execute(
          sql`INSERT INTO chz_connection_settings(id,seller_inn) VALUES(1,${inn}) ON CONFLICT(id) DO UPDATE SET seller_inn=excluded.seller_inn,updated_at=now()`,
        );
        await tx.execute(
          sql`INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,source,correlation_id) VALUES('USER',${actorId},'chz.connect','chz_connection','1','warehouse-settings',${randomUUID()})`,
        );
      });
    },
    replay: (input, actorId) => replay(db, input, actorId),
    async save(input, place, inn, actorId) {
      return db.transaction(async (tx) => {
        // Same lock as shipment creation: the place cannot change under an active sale.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378041)`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378042)`);
        const previous = await replay(tx, input, actorId);
        if (previous) return previous;
        const currentInn = (
          await tx.execute<{ inn: string | null }>(
            sql`SELECT ${connectedSellerInn} AS inn`,
          )
        ).rows[0]?.inn;
        requirePipeline(currentInn === inn, 'SELLER_ACCOUNT_MISMATCH');
        const id = input.warehouseId ?? randomUUID();
        if (input.warehouseId) {
          const warehouse = (
            await tx.execute(
              sql`SELECT id FROM warehouses WHERE id=${id} AND archived_at IS NULL FOR UPDATE`,
            )
          ).rows[0];
          requirePipeline(warehouse, 'WAREHOUSE_UNAVAILABLE');
          const old = (
            await tx.execute<{ fias_id: string }>(
              sql`SELECT fias_id FROM marking_pipeline_settings WHERE warehouse_id=${id}`,
            )
          ).rows[0];
          if (old && old.fias_id !== place.fiasId) {
            const used = (
              await tx.execute(
                sql`SELECT 1 FROM sale_cycles sc JOIN inventory_reservations r ON r.id=sc.reservation_id WHERE r.warehouse_id=${id} AND sc.closed_at IS NULL LIMIT 1`,
              )
            ).rows;
            requirePipeline(!used.length, 'CONFIGURATION_IN_USE');
          }
          await tx.execute(
            sql`UPDATE warehouses SET name=${input.name},fias_id=${place.fiasId},address=${place.address},updated_at=now() WHERE id=${id}`,
          );
        } else {
          await tx.execute(
            sql`INSERT INTO warehouses(id,code,name,fias_id,address) VALUES(${id},${'W-' + id},${input.name},${place.fiasId},${place.address})`,
          );
        }
        await tx.execute(
          sql`INSERT INTO marking_pipeline_settings(warehouse_id,seller_inn,fias_id,address) VALUES(${id},${inn},${place.fiasId},${place.address}) ON CONFLICT(warehouse_id) DO UPDATE SET seller_inn=excluded.seller_inn,fias_id=excluded.fias_id,address=excluded.address,updated_at=now()`,
        );
        for (const [code, name, kind] of [
          ['STOCK', 'Основное хранение', 'SELLABLE'],
          ['PIPE_QUARANTINE', 'Возвратный карантин', 'QUARANTINE'],
          ['PIPE_DEFECT', 'Брак', 'DEFECT'],
        ])
          await tx.execute(
            sql`INSERT INTO stock_locations(warehouse_id,code,name,kind) VALUES(${id},${code},${name},${kind}::stock_location_kind) ON CONFLICT(warehouse_id,code) DO NOTHING`,
          );
        const result = { warehouseId: id };
        await tx.execute(
          sql`INSERT INTO marking_command_results(actor_id,request_id,fingerprint,result) VALUES(${actorId},${input.requestId},${fingerprint(input)},${JSON.stringify(result)}::jsonb)`,
        );
        await tx.execute(
          sql`INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,source,correlation_id) VALUES('USER',${actorId},'warehouse.configure','warehouse',${id},'warehouse-settings',${input.requestId})`,
        );
        return result;
      });
    },
  };
}
