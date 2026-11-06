import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import {
  parseClothingMarking,
  requirePipeline,
  type MarkingWorkStore,
} from '@avito/domain';
import type { Database } from './client.js';
import type { PipelineProtection } from './marking-pipeline.js';
type Row = Record<string, unknown>;
const str = (r: Row, k: string) => (typeof r[k] === 'string' ? r[k] : '');
export function createMarkingWorkStore(
  db: Database,
  protection: PipelineProtection | undefined,
): MarkingWorkStore {
  const query = async (q: ReturnType<typeof sql>) =>
    (await db.execute<Row>(q)).rows;
  const one = async (q: ReturnType<typeof sql>) => {
    const r = (await query(q))[0];
    requirePipeline(r, 'ENTITY_NOT_FOUND');
    return r;
  };
  const identity = (r: Row) => {
    requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
    const parsed = parseClothingMarking(
      protection.decrypt(
        str(r, 'payload_ciphertext'),
        str(r, 'encryption_key_id'),
        str(r, 'identity_hash'),
      ),
      'keyboard-gs1-v1',
    );
    requirePipeline(parsed.ok, 'INVALID_MARKING');
    return parsed.marking.identity;
  };
  const operation = async (
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  ) => {
    const id = randomUUID();
    await tx.execute(
      sql`INSERT INTO inventory_operations(id,kind,idempotency_key,actor_kind,source,correlation_id,occurred_at) VALUES(${id},'MARKING',${'provider:' + id},'SYSTEM','TRUE_API',${randomUUID()},now())`,
    );
    return id;
  };
  async function updateDoc(
    documentId: string,
    status: string,
    externalId?: string,
  ) {
    await db.transaction(async (tx) => {
      const current = (
        await tx.execute<{ status: string; submission_started_at: unknown }>(
          sql`SELECT status,submission_started_at FROM chz_documents WHERE id=${documentId} FOR UPDATE`,
        )
      ).rows[0];
      if (
        status === 'WAITING_SIGNATURE' &&
        (!current ||
          !['PREPARING', 'WAITING_SIGNATURE'].includes(current.status) ||
          current.submission_started_at)
      )
        return;
      const op = await operation(tx);
      await tx.execute(
        sql`UPDATE chz_documents SET status=${status}::chz_progress,external_document_id=coalesce(${externalId ?? null},external_document_id),submitted_at=CASE WHEN ${externalId ?? null}::text IS NOT NULL THEN now() ELSE submitted_at END,last_operation_id=${op} WHERE id=${documentId}`,
      );
      await tx.execute(
        sql`UPDATE chz_operations SET status=${status}::chz_progress,last_operation_id=${op} WHERE id IN (SELECT chz_operation_id FROM chz_document_items WHERE document_id=${documentId}) AND status<>'CONFIRMED'`,
      );
      await tx.execute(
        sql`UPDATE chz_document_items SET status=${status}::chz_progress,last_operation_id=${op} WHERE document_id=${documentId} AND status<>'CONFIRMED'`,
      );
    });
  }
  return {
    async load(id) {
      const job = await one(
          sql`SELECT * FROM integration_operations WHERE id=${id}`,
        ),
        type = str(job, 'operation_type'),
        aggregate = str(job, 'aggregate_id');
      if (type === 'pipeline.check') {
        const r = await one(
          sql`SELECT m.*,st.seller_inn,e.provider_document_id,e.supplier_inn FROM product_units u JOIN unit_markings m ON m.unit_id=u.id AND m.retired_at IS NULL JOIN cost_layers cl ON cl.id=u.cost_layer_id JOIN stock_receipt_items ri ON ri.id=cl.receipt_item_id JOIN stock_receipts sr ON sr.id=ri.receipt_id JOIN marking_pipeline_settings st ON st.warehouse_id=sr.warehouse_id LEFT JOIN marking_supply_evidence e ON e.unit_id=u.id WHERE u.id=${aggregate}`,
        );
        return {
          kind: 'check',
          unitId: aggregate,
          cis: identity(r),
          sellerInn: str(r, 'seller_inn'),
          documentId: str(r, 'provider_document_id') || null,
          supplierInn: str(r, 'supplier_inn') || null,
        };
      }
      if (type === 'pipeline.markings') {
        const order = await one(
          sql`SELECT o.external_order_id,o.status FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=${aggregate}`,
        );
        if (order.status === 'CANCELLED') return null;
        const items = await query(
          sql`SELECT oi.external_line_key,m.* FROM shipment_items si JOIN sale_cycles sc ON sc.id=si.sale_cycle_id JOIN order_items oi ON oi.id=sc.order_item_id JOIN unit_markings m ON m.unit_id=si.unit_id AND m.retired_at IS NULL WHERE si.shipment_id=${aggregate} AND si.removed_at IS NULL ORDER BY oi.external_line_key,si.unit_id`,
        );
        const grouped = new Map<string, string[]>();
        for (const item of items) {
          const key = str(item, 'external_line_key'),
            codes = grouped.get(key) ?? [];
          codes.push(identity(item));
          grouped.set(key, codes);
        }
        return {
          kind: 'markings',
          shipmentId: aggregate,
          externalOrderId: str(order, 'external_order_id'),
          items: [...grouped].map(([avitoId, markings]) => ({
            avitoId,
            markings,
          })),
        };
      }
      if (type !== 'pipeline.document') return null;
      const d = await one(
        sql`SELECT d.*,a.document_type,a.payload_ciphertext,a.encryption_key_id,a.identity_hash,a.payload_hash,st.seller_inn FROM chz_documents d JOIN marking_document_artifacts a ON a.document_id=d.id JOIN marking_pipeline_settings st ON st.warehouse_id=d.warehouse_id WHERE d.id=${aggregate}`,
      );
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      const raw = protection.decrypt(
        str(d, 'payload_ciphertext'),
        str(d, 'encryption_key_id'),
        str(d, 'identity_hash'),
      );
      requirePipeline(
        createHash('sha256').update(raw).digest('hex') === d.payload_hash,
        'SIGNATURE_PAYLOAD_MISMATCH',
      );
      const items = await query(
        sql`SELECT co.action,m.* FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id JOIN unit_markings m ON m.id=co.marking_id WHERE di.document_id=${aggregate} ORDER BY m.id`,
      );
      return {
        kind: 'document',
        documentId: aggregate,
        documentType: str(d, 'document_type'),
        status: str(d, 'status'),
        externalId: str(d, 'external_document_id') || null,
        payloadBase64: Buffer.from(raw).toString('base64'),
        payloadHash: str(d, 'payload_hash'),
        sellerInn: str(d, 'seller_inn'),
        items: items.map((r) => ({
          cis: identity(r),
          target: ['RETURN', 'CORRECT'].includes(str(r, 'action'))
            ? 'INTRODUCED'
            : 'RETIRED',
        })),
        submissionStarted: d.submission_started_at != null,
      };
    },
    async checked(work, observation, supplyVerified) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM product_units WHERE id=${work.unitId} FOR UPDATE`,
        );
        const op = await operation(tx),
          state =
            observation.status === 'INTRODUCED'
              ? 'IN_CIRCULATION'
              : observation.status === 'RETIRED'
                ? 'WITHDRAWN'
                : 'OTHER';
        const mark = (
          await tx.execute<{ id: string }>(
            sql`SELECT id FROM unit_markings WHERE unit_id=${work.unitId} AND retired_at IS NULL`,
          )
        ).rows[0]!;
        await tx.execute(
          sql`INSERT INTO unit_marking_events(marking_id,state,provider_state,source,source_event_id,ownership_verified,operation_id,observed_at) VALUES(${mark.id},${state}::chz_legal_state,${observation.status},'TRUE_API',${op},${observation.ownerInn === work.sellerInn && ['', 'EMPTY'].includes(observation.statusEx) ? 'VERIFIED' : 'REJECTED'},${op},${observation.observedAt}::timestamptz)`,
        );
        await tx.execute(
          sql`UPDATE marking_supply_evidence SET verified_at=${supplyVerified ? observation.observedAt : null}::timestamptz WHERE unit_id=${work.unitId}`,
        );
        await tx.execute(
          sql`UPDATE marking_issues SET resolved_at=now() WHERE entity_id=${work.unitId} AND code LIKE 'CHZ_%'`,
        );
      });
    },
    async markingsAccepted(shipmentId) {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM shipments WHERE id=${shipmentId} FOR UPDATE`,
        );
        const op = await operation(tx);
        await tx.execute(
          sql`UPDATE marking_issues SET resolved_at=now() WHERE entity_id=${shipmentId} AND code LIKE 'AVITO_%'`,
        );
        await tx.execute(
          sql`UPDATE order_unit_assignments SET avito_marking_status='ACCEPTED',provider_confirmed_at=now(),last_operation_id=${op} WHERE sale_cycle_id IN (SELECT sale_cycle_id FROM shipment_items WHERE shipment_id=${shipmentId} AND removed_at IS NULL)`,
        );
        await tx.execute(
          sql`UPDATE shipments SET status='PACKED',last_operation_id=${op} WHERE id=${shipmentId} AND status='DRAFT'`,
        );
        await tx.execute(
          sql`UPDATE orders SET status='PACKED',last_operation_id=${op} WHERE id=(SELECT order_id FROM shipments WHERE id=${shipmentId}) AND status<>'CANCELLED'`,
        );
      });
    },
    async signature(documentId) {
      const r = (
        await query(
          sql`SELECT * FROM signer_jobs WHERE document_id=${documentId} AND status='VERIFIED'`,
        )
      )[0];
      if (!r) return null;
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      return {
        ...(JSON.parse(
          protection.decrypt(
            str(r, 'signature_ciphertext'),
            str(r, 'signature_key_id'),
            str(r, 'signature_identity_hash'),
          ),
        ) as { signatureBase64: string; certificateBase64: string }),
        payloadHash: str(r, 'payload_hash'),
      };
    },
    awaitingSignature: (documentId) =>
      updateDoc(documentId, 'WAITING_SIGNATURE'),
    async submissionStarted(documentId) {
      await db.transaction(async (tx) => {
        const op = await operation(tx);
        const changed = (
          await tx.execute(
            sql`UPDATE chz_documents SET submission_started_at=now(),last_operation_id=${op} WHERE id=${documentId} AND submission_started_at IS NULL AND status IN ('PREPARING','WAITING_SIGNATURE') RETURNING id`,
          )
        ).rows;
        requirePipeline(changed.length === 1, 'INVALID_TRANSITION');
      });
    },
    submitted: (documentId, externalId) =>
      updateDoc(documentId, 'PROCESSING', externalId),
    async processed(documentId, document, observations) {
      requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
      const receipt = JSON.stringify({
          document,
          observations,
          receivedAt: new Date().toISOString(),
        }),
        protectedReceipt = protection.encrypt(
          receipt,
          'provider-receipt:' + documentId,
        );
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM chz_documents WHERE id=${documentId} FOR UPDATE`,
        );
        const op = await operation(tx);
        const items = (
          await tx.execute<Row>(
            sql`SELECT di.id AS item_id,co.*,m.unit_id,m.payload_ciphertext,m.encryption_key_id,m.identity_hash,st.seller_inn FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id JOIN unit_markings m ON m.id=co.marking_id JOIN chz_documents d ON d.id=di.document_id JOIN marking_pipeline_settings st ON st.warehouse_id=d.warehouse_id WHERE di.document_id=${documentId} ORDER BY m.unit_id`,
          )
        ).rows;
        await tx.execute(
          sql`INSERT INTO marking_provider_receipts(document_id,payload_ciphertext,encryption_key_id,identity_hash,payload_hash) VALUES(${documentId},${protectedReceipt.payloadCiphertext},${protectedReceipt.encryptionKeyId},${protectedReceipt.identityHash},${createHash('sha256').update(receipt).digest('hex')})`,
        );
        let complete = document.status === 'CHECKED_OK';
        for (const item of items) {
          if (item.status === 'CONFIRMED') continue;
          const found = observations.find((o) => o.cis === identity(item)),
            target = ['RETURN', 'CORRECT'].includes(str(item, 'action'))
              ? 'INTRODUCED'
              : 'RETIRED';
          const confirmed =
            document.status === 'CHECKED_OK' &&
            document.senderInn === item.seller_inn &&
            found?.status === target &&
            found.ownerInn === item.seller_inn &&
            ['', 'EMPTY'].includes(found.statusEx);
          const rejected =
              ['CHECKED_NOT_OK', 'PARSE_ERROR', 'REJECTED'].includes(
                document.status,
              ) && found?.status !== target,
            status = confirmed
              ? 'CONFIRMED'
              : rejected
                ? 'REJECTED'
                : 'MANUAL_ATTENTION';
          if (!confirmed) complete = false;
          await tx.execute(
            sql`UPDATE chz_operations SET status=${status}::chz_progress,confirmed_at=${confirmed ? new Date() : null}::timestamptz,last_operation_id=${op} WHERE id=${str(item, 'id')}`,
          );
          await tx.execute(
            sql`UPDATE chz_document_items SET status=${status}::chz_progress,error_code=${confirmed ? null : 'CHZ_' + document.status},last_operation_id=${op} WHERE id=${str(item, 'item_id')}`,
          );
          if (confirmed && found) {
            await tx.execute(
              sql`INSERT INTO unit_marking_events(marking_id,state,provider_state,source,source_event_id,ownership_verified,chz_document_item_id,operation_id,observed_at) VALUES(${str(item, 'marking_id')},${target === 'INTRODUCED' ? 'IN_CIRCULATION' : 'WITHDRAWN'}::chz_legal_state,${found.status},'TRUE_API',${documentId + ':' + str(item, 'item_id')},'VERIFIED',${str(item, 'item_id')},${op},${found.observedAt}::timestamptz) ON CONFLICT(source,source_event_id) DO NOTHING`,
            );
            if (target === 'INTRODUCED') await release(tx, item, op);
          }
        }
        await tx.execute(
          sql`UPDATE chz_documents SET status=${complete ? 'CONFIRMED' : 'MANUAL_ATTENTION'}::chz_progress,provider_status=${document.status},processed_at=now(),last_operation_id=${op} WHERE id=${documentId}`,
        );
        if (complete) {
          await tx.execute(
            sql`UPDATE marking_issues SET resolved_at=now() WHERE entity_id=${documentId} AND code IN ('CHZ_UNAVAILABLE','CHZ_DOCUMENT_RESPONSE_MISMATCH','CHZ_CODE_RESPONSE_INCOMPLETE','CHZ_DOCUMENT_TYPE_MISMATCH','SUBMISSION_RESULT_UNKNOWN','SIGNER_WAITING','CHZ_PROCESSING')`,
          );
          const sid = str(items[0] ?? {}, 'shipment_id');
          if (sid) {
            await tx.execute(
              sql`UPDATE shipments SET status='READY',last_operation_id=${op} WHERE id=${sid} AND status='PACKED' AND NOT EXISTS(SELECT 1 FROM chz_operations WHERE shipment_id=${sid} AND action='WITHDRAW' AND status<>'CONFIRMED')`,
            );
            await tx.execute(
              sql`UPDATE orders SET status='READY_TO_SHIP',last_operation_id=${op} WHERE id=(SELECT order_id FROM shipments WHERE id=${sid} AND status='READY')`,
            );
          }
        }
      });
    },
    async defer(id, code, delaySeconds) {
      const job = await one(
        sql`SELECT aggregate_id,operation_type FROM integration_operations WHERE id=${id}`,
      );
      await db.transaction(async (tx) => {
        if (
          ![
            'SIGNER_WAITING',
            'CHZ_PROCESSING',
            'CHZ_AUTH_REQUIRED',
            'DOCUMENT_SUBMISSION_DISABLED',
            'AVITO_WRITES_DISABLED',
          ].includes(code)
        )
          await tx.execute(
            sql`INSERT INTO marking_issues(key,code,entity_id,details) VALUES(${code + ':' + str(job, 'aggregate_id')},${code},${str(job, 'aggregate_id')}::uuid,'{}'::jsonb) ON CONFLICT(key) DO UPDATE SET resolved_at=NULL`,
          );
        if (!delaySeconds) {
          await tx.execute(
            sql`UPDATE integration_operations SET status='MANUAL_ATTENTION',last_error_code=${code} WHERE id=${id} AND status='RUNNING'`,
          );
          await tx.execute(
            sql`UPDATE integration_attempts SET outcome='TERMINAL_FAILURE',error_code=${code},error_class='PROVIDER',finished_at=now() WHERE operation_id=${id} AND outcome='RUNNING'`,
          );
        }
        if (delaySeconds) {
          await tx.execute(
            sql`INSERT INTO integration_operations(operation_type,idempotency_key,aggregate_type,aggregate_id,correlation_id,next_attempt_at) VALUES(${str(job, 'operation_type')},${'poll:' + id},'marking-pipeline',${str(job, 'aggregate_id')},${randomUUID()},now()+${delaySeconds}*interval '1 second') ON CONFLICT(idempotency_key) DO NOTHING`,
          );
        }
      });
    },
  };
}
async function release(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  item: Row,
  op: string,
) {
  const u = (
    await tx.execute<{
      id: string;
      current_state: string;
      current_location_id: string;
      movement_revision: number;
      warehouse_id: string;
    }>(
      sql`SELECT u.*,d.warehouse_id FROM product_units u JOIN chz_documents d ON d.id=(SELECT document_id FROM chz_document_items WHERE chz_operation_id=${str(item, 'id')} ORDER BY created_at DESC LIMIT 1) WHERE u.id=${str(item, 'unit_id')} FOR UPDATE OF u`,
    )
  ).rows[0]!;
  requirePipeline(u.current_state === 'QUARANTINE', 'INVALID_TRANSITION');
  const loc = (
    await tx.execute<{ id: string }>(
      sql`SELECT id FROM stock_locations WHERE warehouse_id=${u.warehouse_id} AND kind='SELLABLE' AND archived_at IS NULL ORDER BY code LIMIT 1`,
    )
  ).rows[0]!;
  const releaseId = randomUUID();
  await tx.execute(
    sql`INSERT INTO inventory_operations(id,kind,idempotency_key,actor_kind,source,correlation_id,occurred_at) VALUES(${releaseId},'RELEASE',${'release:' + releaseId},'SYSTEM','TRUE_API',${randomUUID()},now())`,
  );
  await tx.execute(
    sql`INSERT INTO inventory_movements(operation_id,unit_id,unit_revision,from_state,to_state,from_location_id,to_location_id) VALUES(${releaseId},${u.id},${u.movement_revision + 1},'QUARANTINE','AVAILABLE',${u.current_location_id},${loc.id})`,
  );
  await tx.execute(
    sql`UPDATE sale_cycles SET closed_at=now(),close_reason='RETURNED',last_operation_id=${op} WHERE id=${str(item, 'sale_cycle_id')}`,
  );
  if (item.return_id)
    await tx.execute(
      sql`UPDATE returns SET status='COMPLETED',last_operation_id=${op} WHERE id=${str(item, 'return_id')}`,
    );
}
