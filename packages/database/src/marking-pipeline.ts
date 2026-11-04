import { createHash, randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import {
  buildClothingDocument,
  parseClothingMarking,
  dispatchDeadline,
  legalBlockers,
  requirePipeline,
  type PipelineMode,
  type PipelineStore,
} from '@avito/domain';
import type { Database } from './client.js';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Row = Record<string, unknown>;
export interface PipelineProtection {
  decrypt: (ciphertext: string, keyId: string, identityHash: string) => string;
  encrypt: (
    text: string,
    identity: string,
  ) => {
    payloadCiphertext: string;
    encryptionKeyId: string;
    identityHash: string;
  };
}
const s = (r: Row, k: string) => {
  const value = r[k];
  return value == null
    ? ''
    : value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
};
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows = async (tx: Tx | Database, query: SQL) =>
  (await tx.execute<Row>(query)).rows;
const first = async (tx: Tx | Database, query: SQL) => {
  const r = (await rows(tx, query))[0];
  requirePipeline(r, 'ENTITY_NOT_FOUND');
  return r;
};
const arr = (input: Row, key: string) => input[key] as Row[];
const stringIds = (input: Row, key: string) => input[key] as string[];
const date = (input: Row, key: string) =>
  new Date(String(input[key])).toISOString();
const active = sql`('PREPARING','WAITING_SIGNATURE','SUBMITTED','PROCESSING','UNKNOWN_RESULT','MANUAL_ATTENTION')`;
async function header(
  tx: Tx,
  actorId: string | null,
  kind: string,
  key: string,
  reason: string | null = null,
  at = new Date().toISOString(),
) {
  const id = randomUUID();
  await tx.execute(
    sql`INSERT INTO inventory_operations(id,kind,idempotency_key,actor_kind,actor_user_id,source,reason,correlation_id,occurred_at) VALUES(${id},${kind}::inventory_operation_kind,${key},${actorId ? 'USER' : 'SYSTEM'},${actorId}::uuid,'marking-pipeline',${reason},${randomUUID()},${at}::timestamptz)`,
  );
  return id;
}
async function enqueue(
  tx: Tx,
  type: string,
  aggregateId: string,
  key: string,
  payload: Row = {},
) {
  const result = await first(
    tx,
    sql`INSERT INTO integration_operations(operation_type,idempotency_key,aggregate_type,aggregate_id,payload,correlation_id) VALUES(${type},${key},'marking-pipeline',${aggregateId},${JSON.stringify(payload)}::jsonb,${randomUUID()}) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING id`,
  );
  return s(result, 'id');
}
async function issue(tx: Tx, code: string, id: string, details: Row = {}) {
  await tx.execute(
    sql`INSERT INTO marking_issues(key,code,entity_id,details) VALUES(${code + ':' + id},${code},${id},${JSON.stringify(details)}::jsonb) ON CONFLICT(key) DO UPDATE SET resolved_at=NULL, details=excluded.details`,
  );
}
async function resolve(tx: Tx, id: string, codes: string[]) {
  for (const code of codes)
    await tx.execute(
      sql`UPDATE marking_issues SET resolved_at=now() WHERE entity_id=${id} AND code=${code} AND resolved_at IS NULL`,
    );
}
async function unit(tx: Tx | Database, id: string, lock = false) {
  if (lock)
    await tx.execute(
      sql`SELECT id FROM product_units WHERE id=${id} FOR UPDATE`,
    );
  return first(
    tx,
    sql`SELECT u.id,u.variant_id,u.current_state,u.current_location_id,u.movement_revision,u.internal_code,m.id AS marking_id,m.identity_hash,m.masked_code,coalesce(l.warehouse_id,(SELECT sr.warehouse_id FROM cost_layers cl JOIN stock_receipt_items ri ON ri.id=cl.receipt_item_id JOIN stock_receipts sr ON sr.id=ri.receipt_id WHERE cl.id=u.cost_layer_id)) AS warehouse_id,
    ms.state AS legal_state,ms.ownership_verified,ms.observed_at,
    EXISTS(SELECT 1 FROM marking_supply_evidence e WHERE e.unit_id=u.id AND e.verified_at IS NOT NULL AND e.simulated) AS received_legally,
    ((SELECT e.source FROM unit_marking_events e WHERE e.marking_id=m.id ORDER BY e.observed_at DESC,e.id DESC LIMIT 1)='SIMULATION') AS simulated,
    EXISTS(SELECT 1 FROM chz_operations co WHERE co.marking_id=m.id AND co.status IN ${active}) AS pending
    FROM product_units u JOIN unit_markings m ON m.unit_id=u.id AND m.retired_at IS NULL LEFT JOIN stock_locations l ON l.id=u.current_location_id LEFT JOIN current_marking_states ms ON ms.marking_id=m.id WHERE u.id=${id}`,
  );
}
function blockers(u: Row, mode: PipelineMode) {
  return legalBlockers(
    {
      physicalState: s(u, 'current_state'),
      legalState: s(u, 'legal_state'),
      ownership: s(u, 'ownership_verified'),
      receivedLegally: u.received_legally === true,
      observedAt: s(u, 'observed_at') || null,
      pending: u.pending === true,
      simulated: u.simulated === true,
    },
    new Date(),
    mode,
  );
}
async function movement(
  tx: Tx,
  u: Row,
  op: string,
  to: string,
  location: string | null,
  shipmentItemId: string | null = null,
  returnItemId: string | null = null,
) {
  await tx.execute(
    sql`INSERT INTO inventory_movements(operation_id,unit_id,unit_revision,from_state,to_state,from_location_id,to_location_id,shipment_item_id,return_item_id) VALUES(${op},${s(u, 'id')},${Number(u.movement_revision) + 1},${s(u, 'current_state')}::unit_physical_state,${to}::unit_physical_state,${s(u, 'current_location_id') || null}::uuid,${location}::uuid,${shipmentItemId}::uuid,${returnItemId}::uuid)`,
  );
}
async function location(tx: Tx, warehouseId: string, kind: string) {
  const r = await first(
    tx,
    sql`SELECT id FROM stock_locations WHERE warehouse_id=${warehouseId} AND kind=${kind}::stock_location_kind AND archived_at IS NULL ORDER BY code LIMIT 1`,
  );
  return s(r, 'id');
}
async function shipment(tx: Tx | Database, id: string, lock = false) {
  if (lock)
    await tx.execute(sql`SELECT id FROM shipments WHERE id=${id} FOR UPDATE`);
  return first(
    tx,
    sql`SELECT s.*,o.external_order_id,o.status AS order_status,o.provider_status,o.provider_updated_at FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=${id}`,
  );
}
async function composition(tx: Tx | Database, shipmentId: string) {
  return rows(
    tx,
    sql`SELECT si.id AS shipment_item_id,si.unit_id,si.sale_cycle_id,sc.reservation_id,a.id AS assignment_id,a.packed_at,a.avito_marking_status,oi.unit_price_kopecks,u.current_state AS physical_state,v.name,v.size_label,v.color,m.masked_code,ms.state AS legal_state,(SELECT status FROM chz_operations WHERE sale_cycle_id=sc.id ORDER BY created_at DESC,id DESC LIMIT 1) AS legal_operation_status,(SELECT min(submission_due_at) FROM chz_operations WHERE sale_cycle_id=sc.id) AS submission_due_at FROM shipment_items si JOIN sale_cycles sc ON sc.id=si.sale_cycle_id JOIN order_items oi ON oi.id=sc.order_item_id JOIN order_unit_assignments a ON a.sale_cycle_id=sc.id JOIN product_units u ON u.id=si.unit_id JOIN product_variants v ON v.id=u.variant_id JOIN unit_markings m ON m.unit_id=u.id AND m.retired_at IS NULL LEFT JOIN current_marking_states ms ON ms.marking_id=m.id WHERE si.shipment_id=${shipmentId} AND si.removed_at IS NULL ORDER BY si.unit_id`,
  );
}
async function makeDocument(
  protection: PipelineProtection | undefined,
  tx: Tx,
  op: string,
  action: string,
  reason: string,
  units: {
    unitId: string;
    cycleId?: string;
    shipmentId?: string;
    returnId?: string;
    operationId?: string;
  }[],
  warehouseId: string | null,
  effectiveAt: string,
  due: string | null,
  documentContext: {
    paid?: boolean;
    primaryDocument?: { number: string; date: string; name: string };
  } = {},
) {
  const documentId = randomUUID();
  requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
  const settings = await first(
    tx,
    sql`SELECT * FROM marking_pipeline_settings WHERE warehouse_id=${warehouseId}::uuid`,
  );
  const draftItems: { cis: string; salePriceKopecks?: number }[] = [];
  for (const entry of units) {
    const m = await first(
      tx,
      sql`SELECT payload_ciphertext,encryption_key_id,identity_hash FROM unit_markings WHERE unit_id=${entry.unitId} AND retired_at IS NULL`,
    );
    const parsed = parseClothingMarking(
      protection.decrypt(
        s(m, 'payload_ciphertext'),
        s(m, 'encryption_key_id'),
        s(m, 'identity_hash'),
      ),
      'keyboard-gs1-v1',
    );
    requirePipeline(parsed.ok, 'INVALID_MARKING');
    const price = entry.cycleId
      ? (
          await first(
            tx,
            sql`SELECT oi.unit_price_kopecks FROM sale_cycles sc JOIN order_items oi ON oi.id=sc.order_item_id WHERE sc.id=${entry.cycleId}`,
          )
        ).unit_price_kopecks
      : undefined;
    draftItems.push({
      cis: parsed.marking.identity,
      ...(price != null ? { salePriceKopecks: Number(price) } : {}),
    });
  }
  const original =
    action === 'CORRECT'
      ? await first(
          tx,
          sql`SELECT d.external_document_id FROM chz_documents d JOIN chz_document_items di ON di.document_id=d.id JOIN chz_operations co ON co.id=di.chz_operation_id WHERE co.sale_cycle_id=${units[0]!.cycleId} AND co.action='WITHDRAW' AND d.status='CONFIRMED'`,
        )
      : undefined;
  const draft = buildClothingDocument({
    action: action as 'WITHDRAW' | 'RETURN' | 'WRITE_OFF' | 'CORRECT',
    reason,
    sellerInn: s(settings, 'seller_inn'),
    fiasId: s(settings, 'fias_id'),
    effectiveAt,
    items: draftItems,
    ...(original
      ? { cancelledDocumentId: s(original, 'external_document_id') }
      : {}),
    ...documentContext,
  });
  const bytes = JSON.stringify(draft.body),
    payloadHash = createHash('sha256').update(bytes).digest('hex');
  const encrypted = protection.encrypt(bytes, 'document:' + documentId);

  await tx.execute(
    sql`INSERT INTO chz_documents(id,submission_mode,action,warehouse_id,schema_version,payload_hash,last_operation_id) VALUES(${documentId},'DIRECT_TRUE_API',${action}::chz_action,${warehouseId}::uuid,'simulation-lp-v1',${payloadHash},${op})`,
  );
  await tx.execute(
    sql`INSERT INTO marking_document_artifacts(document_id,document_type,payload_ciphertext,encryption_key_id,identity_hash,payload_hash,byte_length) VALUES(${documentId},${draft.type},${encrypted.payloadCiphertext},${encrypted.encryptionKeyId},${encrypted.identityHash},${payloadHash},${Buffer.byteLength(bytes)})`,
  );
  await tx.execute(
    sql`INSERT INTO marking_signing_tasks(document_id,seller_inn,simulated) VALUES(${documentId},${s(settings, 'seller_inn')},true)`,
  );
  const job = await enqueue(
    tx,
    'pipeline.document',
    documentId,
    'pipeline.document:' + documentId,
  );
  for (const entry of units) {
    const u = await unit(tx, entry.unitId, true);
    requirePipeline(u.pending !== true, 'LEGAL_OPERATION_PENDING');
    const id = entry.operationId ?? randomUUID();
    if (entry.operationId)
      await tx.execute(
        sql`UPDATE chz_operations SET status='PREPARING',integration_operation_id=${job},confirmed_at=NULL,last_operation_id=${op} WHERE id=${id} AND status='REJECTED'`,
      );
    else
      await tx.execute(
        sql`INSERT INTO chz_operations(id,marking_id,action,reason,sale_cycle_id,shipment_id,return_id,submission_mode,idempotency_key,integration_operation_id,effective_at,submission_due_at,last_operation_id) VALUES(${id},${s(u, 'marking_id')},${action}::chz_action,${reason},${entry.cycleId ?? null}::uuid,${entry.shipmentId ?? null}::uuid,${entry.returnId ?? null}::uuid,'DIRECT_TRUE_API',${'pipeline:' + action + ':' + (entry.cycleId ?? documentId) + ':' + entry.unitId},${job},${effectiveAt}::timestamptz,${due}::timestamptz,${op})`,
      );
    await tx.execute(
      sql`INSERT INTO chz_document_items(document_id,chz_operation_id,last_operation_id) VALUES(${documentId},${id},${op})`,
    );
  }
  return documentId;
}
async function calendar(tx: Tx | Database) {
  const result: Record<string, boolean> = {};
  for (const r of await rows(
    tx,
    sql`SELECT date,working FROM marking_business_days`,
  ))
    result[s(r, 'date')] = r.working === true;
  return result;
}
async function checkUnit(tx: Tx, unitId: string, op: string) {
  const u = await unit(tx, unitId, true);
  const facts = (
    await rows(
      tx,
      sql`SELECT f.*,st.seller_inn FROM marking_simulation_units f CROSS JOIN marking_pipeline_settings st JOIN warehouses w ON w.id=st.warehouse_id WHERE f.unit_id=${unitId} AND st.warehouse_id=coalesce(${s(u, 'warehouse_id') || null}::uuid,st.warehouse_id) ORDER BY st.warehouse_id LIMIT 1`,
    )
  )[0];
  if (!facts) {
    await issue(tx, 'LEGAL_FACTS_MISSING', unitId);
    return;
  }
  const state =
    s(facts, 'provider_state') === 'INTRODUCED'
      ? 'IN_CIRCULATION'
      : s(facts, 'provider_state') === 'RETIRED'
        ? 'WITHDRAWN'
        : 'OTHER';
  const owner = facts.owner_inn === facts.seller_inn ? 'VERIFIED' : 'REJECTED';
  await tx.execute(
    sql`INSERT INTO unit_marking_events(marking_id,state,provider_state,source,source_event_id,ownership_verified,operation_id,observed_at) VALUES(${s(u, 'marking_id')},${state}::chz_legal_state,${s(facts, 'provider_state')},'SIMULATION',${op + ':' + unitId},${owner},${op},now()) ON CONFLICT(source,source_event_id) DO NOTHING`,
  );
  if (owner === 'VERIFIED' && state === 'IN_CIRCULATION') {
    await tx.execute(
      sql`UPDATE marking_supply_evidence SET verified_at=now() WHERE unit_id=${unitId} AND simulated`,
    );
    await resolve(tx, unitId, ['LEGAL_FACTS_MISSING', 'LEGAL_CODE_BLOCKED']);
  } else
    await issue(tx, 'LEGAL_CODE_BLOCKED', unitId, { state, ownership: owner });
}

export function createMarkingPipelineStore(
  db: Database,
  protection?: PipelineProtection,
): PipelineStore {
  return {
    async execute(action, input, actorId, mode) {
      requirePipeline(mode === 'simulation', 'LEGAL_PROVIDER_DISABLED');
      return db.transaction(async (tx) => {
        // One bounded writer lane prevents opposite lock orders across multi-unit workflows.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378041)`);
        const fingerprint = hash({ action, input });
        const requestKey = actorId + ':' + input.requestId;
        const previous = (
          await rows(
            tx,
            sql`SELECT fingerprint,result FROM marking_command_results WHERE actor_id=${actorId} AND request_id=${input.requestId}`,
          )
        )[0];
        if (previous) {
          requirePipeline(
            previous.fingerprint === fingerprint,
            'IDEMPOTENCY_CONFLICT',
          );
          return {
            ok: true,
            simulated: true,
            replayed: true,
            result: previous.result,
          };
        }
        let result: Row = {};
        if (action === 'configure') {
          const current = (
            await rows(
              tx,
              sql`SELECT * FROM marking_pipeline_settings WHERE warehouse_id=${String(input.warehouseId)}`,
            )
          )[0];
          if (
            current &&
            (current.seller_inn !== input.sellerInn ||
              current.fias_id !== input.fiasId)
          )
            requirePipeline(
              !(
                await rows(
                  tx,
                  sql`SELECT sc.id FROM sale_cycles sc JOIN inventory_reservations r ON r.id=sc.reservation_id WHERE r.warehouse_id=${String(input.warehouseId)} AND sc.closed_at IS NULL`,
                )
              ).length,
              'CONFIGURATION_IN_USE',
            );
          await tx.execute(
            sql`INSERT INTO marking_pipeline_settings(warehouse_id,seller_inn,fias_id,address,fiscal_evidence_reference) VALUES(${String(input.warehouseId)},${String(input.sellerInn)},${String(input.fiasId)},${String(input.address)},${String(input.fiscalEvidenceReference)}) ON CONFLICT(warehouse_id) DO UPDATE SET seller_inn=excluded.seller_inn,fias_id=excluded.fias_id,address=excluded.address,fiscal_evidence_reference=excluded.fiscal_evidence_reference,updated_at=now()`,
          );
          for (const [code, name, kind] of [
            ['PIPE_QUARANTINE', 'Возвратный карантин', 'QUARANTINE'],
            ['PIPE_DEFECT', 'Брак', 'DEFECT'],
          ])
            await tx.execute(
              sql`INSERT INTO stock_locations(warehouse_id,code,name,kind) VALUES(${String(input.warehouseId)},${code},${name},${kind}::stock_location_kind) ON CONFLICT(warehouse_id,code) DO NOTHING`,
            );
          result = { warehouseId: input.warehouseId };
        } else if (action === 'calendar') {
          for (const day of arr(input, 'days'))
            await tx.execute(
              sql`INSERT INTO marking_business_days(date,working) VALUES(${String(day.date)},${day.working === true}) ON CONFLICT(date) DO UPDATE SET working=excluded.working`,
            );
          result = { count: arr(input, 'days').length };
        } else if (action === 'supply') {
          const ids = stringIds(input, 'unitIds');
          requirePipeline(new Set(ids).size === ids.length, 'DUPLICATE_UNIT');
          for (const id of [...ids].sort()) {
            await unit(tx, id, true);
            const existing = (
              await rows(
                tx,
                sql`SELECT * FROM marking_supply_evidence WHERE unit_id=${id}`,
              )
            )[0];
            requirePipeline(
              !existing ||
                (existing.document_number === input.documentNumber &&
                  existing.supplier_inn === input.supplierInn &&
                  existing.evidence_reference === input.evidenceReference),
              'SUPPLY_EVIDENCE_CONFLICT',
            );
            await tx.execute(
              sql`INSERT INTO marking_supply_evidence(unit_id,document_number,document_date,supplier_inn,evidence_reference,simulated) VALUES(${id},${String(input.documentNumber)},${String(input.documentDate)},${String(input.supplierInn)},${String(input.evidenceReference)},true) ON CONFLICT(unit_id) DO NOTHING`,
            );
            await enqueue(
              tx,
              'pipeline.check',
              id,
              'pipeline.supply:' + requestKey + ':' + id,
            );
          }
          result = { unitIds: ids, status: 'VERIFICATION_PENDING' };
        } else if (action === 'simulate') {
          await unit(tx, String(input.unitId), true);
          await tx.execute(
            sql`INSERT INTO marking_simulation_units(unit_id,provider_state,owner_inn,outcome) VALUES(${String(input.unitId)},${String(input.state)},${String(input.ownerInn)},${String(input.outcome)}) ON CONFLICT(unit_id) DO UPDATE SET provider_state=excluded.provider_state,owner_inn=excluded.owner_inn,outcome=excluded.outcome,updated_at=now()`,
          );
          result = {
            unitId: input.unitId,
            operationId: await enqueue(
              tx,
              'pipeline.check',
              String(input.unitId),
              'pipeline.simulate:' + requestKey,
            ),
          };
        } else if (action === 'check') {
          await unit(tx, String(input.unitId), true);
          result = {
            operationId: await enqueue(
              tx,
              'pipeline.check',
              String(input.unitId),
              'pipeline.check:' + requestKey,
            ),
          };
        } else if (action === 'create') {
          const warehouseId = String(input.warehouseId);
          await first(
            tx,
            sql`SELECT * FROM marking_pipeline_settings WHERE warehouse_id=${warehouseId}`,
          );
          requirePipeline(
            new Set(arr(input, 'items').map((i) => i.externalLineKey)).size ===
              arr(input, 'items').length,
            'DUPLICATE_LINE',
          );
          const op = await header(
            tx,
            actorId,
            'RESERVE',
            'pipeline:' + requestKey,
          );
          const channel = await first(
            tx,
            sql`INSERT INTO sales_channels(provider,external_account_id,name) VALUES('AVITO_SIMULATION',${String(input.externalAccountId)},'Авито — симуляция') ON CONFLICT(provider,external_account_id) DO UPDATE SET name=excluded.name RETURNING id`,
          );
          requirePipeline(
            !(
              await rows(
                tx,
                sql`SELECT id FROM orders WHERE channel_id=${s(channel, 'id')} AND external_order_id=${String(input.externalOrderId)}`,
              )
            ).length,
            'ORDER_ALREADY_IMPORTED',
          );
          const orderId = randomUUID(),
            shipmentId = randomUUID();
          await tx.execute(
            sql`INSERT INTO orders(id,channel_id,external_order_id,status,provider_status,available_actions,ordered_at,provider_updated_at,last_operation_id) VALUES(${orderId},${s(channel, 'id')},${String(input.externalOrderId)},'NEW','ready_to_ship','["setMarkings"]'::jsonb,now(),now(),${op})`,
          );
          await tx.execute(
            sql`INSERT INTO shipments(id,order_id,warehouse_id,parcel_code,last_operation_id) VALUES(${shipmentId},${orderId},${warehouseId},${String(input.parcelCode)},${op})`,
          );
          const selected: string[] = [];
          for (const line of arr(input, 'items')) {
            const itemId = randomUUID();
            await tx.execute(
              sql`INSERT INTO order_items(id,order_id,channel_id,external_line_key,variant_id,title_snapshot,quantity,unit_price_kopecks,mapping_status,last_operation_id) SELECT ${itemId},${orderId},${s(channel, 'id')},${String(line.externalLineKey)},id,name,${Number(line.quantity)},${Number(line.unitPriceKopecks)},'VERIFIED',${op} FROM product_variants WHERE id=${String(line.variantId)}`,
            );
            const candidates = await rows(
              tx,
              sql`SELECT u.id FROM product_units u JOIN stock_unit_availability av ON av.unit_id=u.id JOIN current_marking_states ms ON ms.marking_id=(SELECT m.id FROM unit_markings m WHERE m.unit_id=u.id AND m.retired_at IS NULL) JOIN marking_supply_evidence e ON e.unit_id=u.id WHERE u.variant_id=${String(line.variantId)} AND av.warehouse_id=${warehouseId} AND av.is_eligible AND av.reservation_id IS NULL AND e.simulated AND e.verified_at IS NOT NULL AND ms.state='IN_CIRCULATION' AND ms.ownership_verified='VERIFIED' AND ms.observed_at>now()-interval '15 minutes' ORDER BY u.id FOR UPDATE OF u`,
            );
            requirePipeline(
              candidates.length >= Number(line.quantity),
              'INSUFFICIENT_LEGAL_STOCK',
            );
            for (const candidate of candidates.slice(
              0,
              Number(line.quantity),
            )) {
              const unitId = s(candidate, 'id'),
                reservationId = randomUUID(),
                cycleId = randomUUID();
              const u = await unit(tx, unitId, true);
              const blocked = blockers(u, mode);
              requirePipeline(!blocked.length, 'LEGAL_NOT_READY', blocked);
              await tx.execute(
                sql`INSERT INTO inventory_reservations(id,order_item_id,unit_id,variant_id,warehouse_id,last_operation_id) VALUES(${reservationId},${itemId},${unitId},${String(line.variantId)},${warehouseId},${op})`,
              );
              await tx.execute(
                sql`INSERT INTO sale_cycles(id,unit_id,order_item_id,reservation_id,cycle_number,last_operation_id) SELECT ${cycleId},${unitId},${itemId},${reservationId},coalesce(max(cycle_number),0)+1,${op} FROM sale_cycles WHERE unit_id=${unitId}`,
              );
              await tx.execute(
                sql`INSERT INTO order_unit_assignments(sale_cycle_id,last_operation_id) VALUES(${cycleId},${op})`,
              );
              await tx.execute(
                sql`INSERT INTO shipment_items(shipment_id,sale_cycle_id,unit_id,last_operation_id) VALUES(${shipmentId},${cycleId},${unitId},${op})`,
              );
              selected.push(unitId);
            }
          }
          await tx.execute(
            sql`UPDATE orders SET status='RESERVED',last_operation_id=${await header(tx, actorId, 'OTHER', 'pipeline:reserved:' + requestKey)} WHERE id=${orderId}`,
          );
          result = { orderId, shipmentId, unitIds: selected };
        } else if (
          [
            'pack',
            'prepare',
            'handover',
            'deliver',
            'cancel',
            'return',
          ].includes(action)
        ) {
          const sh = await shipment(tx, String(input.shipmentId), true),
            items = await composition(tx, s(sh, 'id'));
          const warehouseId = s(sh, 'warehouse_id'),
            shipmentId = s(sh, 'id');
          requirePipeline(items.length > 0, 'EMPTY_SHIPMENT');
          if (action === 'pack') {
            requirePipeline(sh.status === 'DRAFT', 'COMPOSITION_FROZEN');
            const parsed = parseClothingMarking(
              String(input.raw),
              input.scannerProfile as 'camera-gs1-v1' | 'keyboard-gs1-v1',
            );
            requirePipeline(parsed.ok, 'INVALID_MARKING');
            const identityHash = createHash('sha256')
              .update(parsed.marking.identity)
              .digest('hex');
            const found = await first(
              tx,
              sql`SELECT unit_id FROM unit_markings WHERE identity_hash=${identityHash} AND retired_at IS NULL`,
            );
            const item = items.find((i) => i.unit_id === found.unit_id);
            requirePipeline(item, 'WRONG_UNIT');
            const u = await unit(tx, s(item, 'unit_id'), true);
            const blocked = blockers(u, mode);
            requirePipeline(!blocked.length, 'LEGAL_NOT_READY', blocked);
            if (!item.packed_at) {
              const op = await header(
                tx,
                actorId,
                'PACK',
                'pipeline:' + requestKey,
              );
              await movement(tx, u, op, 'PACKING', s(u, 'current_location_id'));
              await tx.execute(
                sql`UPDATE order_unit_assignments SET packed_at=now(),avito_marking_status='PENDING',last_operation_id=${op} WHERE id=${s(item, 'assignment_id')}`,
              );
            }
            if (items.every((i) => i.packed_at || i.unit_id === found.unit_id))
              result = {
                shipmentId,
                operationId: await enqueue(
                  tx,
                  'pipeline.markings',
                  shipmentId,
                  'pipeline.markings:' + shipmentId,
                ),
                status: 'MARKING_PENDING',
              };
            else result = { shipmentId, status: 'PICKING' };
          } else if (action === 'prepare') {
            requirePipeline(
              sh.status === 'PACKED' &&
                !sh.prepared_at &&
                sh.order_status !== 'CANCELLED',
              'SHIPMENT_NOT_PACKED',
            );
            const now = new Date().toISOString();
            dispatchDeadline(now, await calendar(tx)); // Require an actual business calendar before preparing documents.
            for (const item of items) {
              requirePipeline(
                item.packed_at && item.avito_marking_status === 'ACCEPTED',
                'MARKINGS_NOT_ACCEPTED',
              );
              const u = await unit(tx, s(item, 'unit_id'), true);
              const blocked = blockers(u, mode);
              requirePipeline(!blocked.length, 'LEGAL_NOT_READY', blocked);
            }
            const op = await header(
              tx,
              actorId,
              'PREPARE_SHIPMENT',
              'pipeline:' + requestKey,
            );
            await tx.execute(
              sql`UPDATE shipments SET prepared_at=${now}::timestamptz,last_operation_id=${op} WHERE id=${shipmentId}`,
            );
            const documentId = await makeDocument(
              protection,
              tx,
              op,
              'WITHDRAW',
              'DISTANCE',
              items.map((i) => ({
                unitId: s(i, 'unit_id'),
                cycleId: s(i, 'sale_cycle_id'),
                shipmentId,
              })),
              warehouseId,
              now,
              null,
            );
            result = { shipmentId, documentId, status: 'LEGAL_PENDING' };
          } else if (action === 'handover') {
            requirePipeline(
              ['DRAFT', 'PACKED', 'READY'].includes(s(sh, 'status')) &&
                sh.order_status !== 'CANCELLED',
              'INVALID_TRANSITION',
            );
            const at = date(input, 'occurredAt');
            requirePipeline(
              Date.parse(at) <= Date.now() + 5000,
              'FUTURE_EVENT',
            );
            const outside = input.occurredOutsideApp === true;
            requirePipeline(
              outside || sh.status === 'READY',
              'LEGAL_NOT_READY',
            );
            requirePipeline(
              outside ||
                Date.now() - Date.parse(s(sh, 'prepared_at')) <= 30 * 60_000,
              'PREPARATION_EXPIRED',
            );
            if (!outside)
              for (const item of items) {
                const u = await unit(tx, s(item, 'unit_id'), true);
                requirePipeline(
                  u.legal_state === 'WITHDRAWN' &&
                    u.ownership_verified === 'VERIFIED' &&
                    u.pending !== true &&
                    u.simulated === true,
                  'LEGAL_NOT_READY',
                );
              }
            let due: string | null = null;
            try {
              due = dispatchDeadline(at, await calendar(tx));
            } catch (error) {
              if (!outside) throw error;
              await issue(tx, 'CALENDAR_INCOMPLETE', shipmentId);
            }
            const op = await header(
              tx,
              actorId,
              'SHIP',
              'pipeline:' + requestKey,
              null,
              at,
            );
            await tx.execute(
              sql`UPDATE shipments SET status='HANDED_OVER',handed_over_at=${at}::timestamptz,handover_source=${outside ? 'OPERATOR_EXCEPTION' : 'OPERATOR'},handover_evidence_reference=${String(input.evidenceReference)},last_operation_id=${op} WHERE id=${shipmentId}`,
            );
            for (const item of items) {
              const u = await unit(tx, s(item, 'unit_id'), true);
              await movement(
                tx,
                u,
                op,
                'IN_TRANSIT',
                null,
                s(item, 'shipment_item_id'),
              );
              await tx.execute(
                sql`UPDATE inventory_reservations SET status='CONSUMED',ended_at=now(),last_operation_id=${op} WHERE id=${s(item, 'reservation_id')}`,
              );
            }
            await tx.execute(
              sql`UPDATE orders SET status='SHIPPED',last_operation_id=${op} WHERE id=${s(sh, 'order_id')}`,
            );
            await tx.execute(
              sql`UPDATE chz_operations SET submission_due_at=${due}::timestamptz,last_operation_id=${op} WHERE shipment_id=${shipmentId} AND action='WITHDRAW'`,
            );
            const existing = await rows(
              tx,
              sql`SELECT id FROM chz_operations WHERE shipment_id=${shipmentId} AND action='WITHDRAW'`,
            );
            if (!existing.length)
              await makeDocument(
                protection,
                tx,
                op,
                'WITHDRAW',
                'DISTANCE',
                items.map((i) => ({
                  unitId: s(i, 'unit_id'),
                  cycleId: s(i, 'sale_cycle_id'),
                  shipmentId,
                })),
                warehouseId,
                at,
                due,
              );
            if (outside)
              await issue(tx, 'HANDOVER_OUTSIDE_APP', shipmentId, {
                dueAt: due,
              });
            result = { shipmentId, status: 'HANDED_OVER', dueAt: due };
          } else if (action === 'deliver') {
            requirePipeline(sh.status === 'HANDED_OVER', 'INVALID_TRANSITION');
            const at = date(input, 'occurredAt');
            requirePipeline(
              Date.parse(at) >= Date.parse(s(sh, 'handed_over_at')) &&
                Date.parse(at) <= Date.now() + 5000,
              'INVALID_EVENT_TIME',
            );
            const op = await header(
              tx,
              actorId,
              'DELIVER',
              'pipeline:' + requestKey,
              null,
              at,
            );
            for (const item of items)
              await movement(
                tx,
                await unit(tx, s(item, 'unit_id'), true),
                op,
                'WITH_CUSTOMER',
                null,
                s(item, 'shipment_item_id'),
              );
            await tx.execute(
              sql`UPDATE shipments SET status='DELIVERED',delivered_at=${at}::timestamptz,last_operation_id=${op} WHERE id=${shipmentId}`,
            );
            await tx.execute(
              sql`UPDATE orders SET status='DELIVERED',last_operation_id=${op} WHERE id=${s(sh, 'order_id')}`,
            );
            await tx.execute(
              sql`UPDATE chz_operations SET submission_due_at=least(submission_due_at,${at}::timestamptz),last_operation_id=${op} WHERE shipment_id=${shipmentId} AND action='WITHDRAW'`,
            );
            result = { shipmentId, status: 'DELIVERED' };
          } else if (action === 'cancel') {
            requirePipeline(
              !sh.handed_over_at && sh.status !== 'CANCELLED',
              'USE_RETURN_WORKFLOW',
            );
            for (const item of items) {
              const u = await unit(tx, s(item, 'unit_id'), true);
              requirePipeline(
                u.pending !== true,
                'RECONCILE_BEFORE_COMPENSATION',
              );
            }
            requirePipeline(
              !(
                await rows(
                  tx,
                  sql`SELECT d.id FROM chz_documents d JOIN chz_document_items di ON di.document_id=d.id JOIN chz_operations co ON co.id=di.chz_operation_id WHERE co.shipment_id=${shipmentId} AND co.action='WITHDRAW' AND d.status<>'CONFIRMED'`,
                )
              ).length,
              'CANCELLATION_REQUIRES_REVIEW',
            );
            const op = await header(
              tx,
              actorId,
              'UNPACK',
              'pipeline:' + requestKey,
              String(input.reason),
            );
            const pendingReturns: {
              unitId: string;
              cycleId: string;
              shipmentId: string;
            }[] = [];
            for (const item of items) {
              const u = await unit(tx, s(item, 'unit_id'), true),
                withdrawn = u.legal_state === 'WITHDRAWN';
              if (u.current_state === 'PACKING')
                await movement(
                  tx,
                  u,
                  op,
                  withdrawn ? 'QUARANTINE' : 'AVAILABLE',
                  withdrawn
                    ? await location(tx, warehouseId, 'QUARANTINE')
                    : s(u, 'current_location_id'),
                );
              await tx.execute(
                sql`UPDATE inventory_reservations SET status='RELEASED',ended_at=now(),last_operation_id=${op} WHERE id=${s(item, 'reservation_id')}`,
              );
              if (withdrawn)
                pendingReturns.push({
                  unitId: s(item, 'unit_id'),
                  cycleId: s(item, 'sale_cycle_id'),
                  shipmentId,
                });
              else
                await tx.execute(
                  sql`UPDATE sale_cycles SET closed_at=now(),close_reason='CANCELLED',last_operation_id=${op} WHERE id=${s(item, 'sale_cycle_id')}`,
                );
            }
            await tx.execute(
              sql`UPDATE shipments SET status='CANCELLED',last_operation_id=${op} WHERE id=${shipmentId}`,
            );
            await tx.execute(
              sql`UPDATE orders SET status='CANCELLED',last_operation_id=${op} WHERE id=${s(sh, 'order_id')}`,
            );
            if (pendingReturns.length)
              await makeDocument(
                protection,
                tx,
                op,
                'CORRECT',
                'CANCELLED_BEFORE_HANDOVER',
                pendingReturns,
                warehouseId,
                new Date().toISOString(),
                null,
              );
            result = { shipmentId, status: 'CANCELLED' };
          } else {
            requirePipeline(sh.handed_over_at, 'NOT_SHIPPED');
            const parsed = parseClothingMarking(
              String(input.raw),
              input.scannerProfile as 'camera-gs1-v1' | 'keyboard-gs1-v1',
            );
            requirePipeline(parsed.ok, 'INVALID_MARKING');
            const found = await first(
              tx,
              sql`SELECT unit_id FROM unit_markings WHERE identity_hash=${createHash('sha256').update(parsed.marking.identity).digest('hex')} AND retired_at IS NULL`,
            );
            const item = items.find((i) => i.unit_id === found.unit_id);
            requirePipeline(item, 'WRONG_UNIT');
            const u = await unit(tx, s(item, 'unit_id'), true);
            requirePipeline(
              u.pending !== true,
              'RECONCILE_BEFORE_COMPENSATION',
            );
            requirePipeline(
              ['IN_TRANSIT', 'WITH_CUSTOMER', 'RETURN_IN_TRANSIT'].includes(
                s(u, 'current_state'),
              ),
              'INVALID_TRANSITION',
            );
            const at = date(input, 'occurredAt');
            requirePipeline(
              Date.parse(at) >= Date.parse(s(sh, 'handed_over_at')) &&
                Date.parse(at) <= Date.now() + 5000,
              'INVALID_EVENT_TIME',
            );
            const op = await header(
                tx,
                actorId,
                'RETURN',
                'pipeline:' + requestKey,
                null,
                at,
              ),
              returnId = randomUUID(),
              returnItemId = randomUUID();
            await tx.execute(
              sql`INSERT INTO returns(id,order_id,external_return_id,kind,status,warehouse_id,received_at,last_operation_id) VALUES(${returnId},${s(sh, 'order_id')},${input.requestId},${String(input.kind)},'INSPECTED',${warehouseId},${at}::timestamptz,${op})`,
            );
            await tx.execute(
              sql`INSERT INTO return_items(id,return_id,shipment_item_id,unit_id,condition,inspected_at,inspection_note,last_operation_id) VALUES(${returnItemId},${returnId},${s(item, 'shipment_item_id')},${s(u, 'id')},${String(input.condition)},now(),${String(input.note)},${op})`,
            );
            await movement(
              tx,
              u,
              op,
              'QUARANTINE',
              await location(tx, warehouseId, 'QUARANTINE'),
              null,
              returnItemId,
            );
            if (input.condition === 'GOOD' && u.legal_state === 'WITHDRAWN')
              result = {
                returnId,
                documentId: await makeDocument(
                  protection,
                  tx,
                  op,
                  'RETURN',
                  'CUSTOMER_RETURN',
                  [
                    {
                      unitId: s(u, 'id'),
                      cycleId: s(item, 'sale_cycle_id'),
                      returnId,
                    },
                  ],
                  warehouseId,
                  at,
                  null,
                  {
                    paid: input.paid === true,
                    ...(input.primaryDocument
                      ? {
                          primaryDocument: input.primaryDocument as {
                            number: string;
                            date: string;
                            name: string;
                          },
                        }
                      : {}),
                  },
                ),
                status: 'LEGAL_PENDING',
              };
            else if (
              input.condition === 'GOOD' &&
              u.legal_state === 'IN_CIRCULATION' &&
              u.ownership_verified === 'VERIFIED'
            ) {
              await releaseReturn(
                tx,
                s(u, 'id'),
                s(item, 'sale_cycle_id'),
                returnId,
                warehouseId,
              );
              result = { returnId, status: 'COMPLETED' };
            } else {
              await issue(
                tx,
                input.condition === 'GOOD'
                  ? 'LEGAL_RETURN_REVIEW'
                  : String(input.condition),
                s(u, 'id'),
                { returnId },
              );
              result = { returnId, status: 'QUARANTINE' };
            }
          }
        } else if (action === 'dispose') {
          const u = await unit(tx, String(input.unitId), true);
          requirePipeline(u.pending !== true, 'RECONCILE_BEFORE_COMPENSATION');
          requirePipeline(
            !['NOT_RECEIVED', 'LOST', 'DISPOSED', 'WITH_SUPPLIER'].includes(
              s(u, 'current_state'),
            ),
            'INVALID_TRANSITION',
          );
          requirePipeline(
            !(
              await rows(
                tx,
                sql`SELECT id FROM inventory_reservations WHERE unit_id=${s(u, 'id')} AND status='ACTIVE'`,
              )
            ).length,
            'UNIT_RESERVED',
          );
          requirePipeline(
            ['IN_CIRCULATION', 'WITHDRAWN'].includes(s(u, 'legal_state')) &&
              u.ownership_verified === 'VERIFIED',
            'LEGAL_NOT_READY',
          );
          const at = date(input, 'occurredAt');
          requirePipeline(Date.parse(at) <= Date.now() + 5000, 'FUTURE_EVENT');
          requirePipeline(
            input.reason === 'LOSS' || !!u.current_location_id,
            'PHYSICAL_RECEIPT_REQUIRED',
          );
          const op = await header(
            tx,
            actorId,
            input.reason === 'LOSS' ? 'LOSS' : 'DISPOSE',
            'pipeline:' + requestKey,
            String(input.evidenceReference),
            at,
          );
          await movement(
            tx,
            u,
            op,
            input.reason === 'LOSS' ? 'LOST' : 'DISPOSED',
            null,
          );
          if (u.legal_state === 'IN_CIRCULATION')
            result = {
              documentId: await makeDocument(
                protection,
                tx,
                op,
                'WRITE_OFF',
                String(input.reason),
                [{ unitId: s(u, 'id') }],
                s(u, 'warehouse_id') || null,
                at,
                dispatchDeadline(at, await calendar(tx)),
                {
                  primaryDocument: input.primaryDocument as {
                    number: string;
                    date: string;
                    name: string;
                  },
                },
              ),
            };
          else
            result = {
              unitId: s(u, 'id'),
              legalAction: 'NONE_ALREADY_WITHDRAWN',
            };
        } else if (action === 'correctDocument') {
          const original = await first(
            tx,
            sql`SELECT * FROM chz_documents WHERE id=${String(input.documentId)} FOR UPDATE`,
          );
          requirePipeline(
            original.status === 'MANUAL_ATTENTION',
            'INVALID_TRANSITION',
          );
          const failed = await rows(
            tx,
            sql`SELECT co.*,m.unit_id FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id JOIN unit_markings m ON m.id=co.marking_id WHERE di.document_id=${String(input.documentId)} AND di.status='REJECTED' AND co.status='REJECTED' ORDER BY m.unit_id`,
          );
          requirePipeline(failed.length > 0, 'RECONCILE_BEFORE_COMPENSATION');
          requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
          const artifact = await first(
            tx,
            sql`SELECT * FROM marking_document_artifacts WHERE document_id=${String(input.documentId)}`,
          );
          const oldBody = JSON.parse(
            protection.decrypt(
              s(artifact, 'payload_ciphertext'),
              s(artifact, 'encryption_key_id'),
              s(artifact, 'identity_hash'),
            ),
          ) as Row;
          const primaryNumber =
            s(oldBody, 'primary_document_number') ||
            s(oldBody, 'document_number');
          const primaryDate =
            s(oldBody, 'primary_document_date') || s(oldBody, 'document_date');
          const primaryName = s(oldBody, 'primary_document_custom_name');
          const context = {
            ...(typeof oldBody.paid === 'boolean'
              ? { paid: oldBody.paid }
              : {}),
            ...(primaryNumber
              ? {
                  primaryDocument: {
                    number: primaryNumber,
                    date: primaryDate,
                    name: primaryName,
                  },
                }
              : {}),
          };
          const op = await header(
            tx,
            actorId,
            'MARKING',
            'pipeline:' + requestKey,
            String(input.reason),
          );
          const documentId = await makeDocument(
            protection,
            tx,
            op,
            s(original, 'action'),
            s(failed[0]!, 'reason'),
            failed.map((i) => ({
              unitId: s(i, 'unit_id'),
              ...(i.sale_cycle_id ? { cycleId: s(i, 'sale_cycle_id') } : {}),
              ...(i.shipment_id ? { shipmentId: s(i, 'shipment_id') } : {}),
              ...(i.return_id ? { returnId: s(i, 'return_id') } : {}),
              operationId: s(i, 'id'),
            })),
            s(original, 'warehouse_id'),
            s(failed[0]!, 'effective_at'),
            s(failed[0]!, 'submission_due_at') || null,
            context,
          );
          result = { documentId, supersedesDocumentId: input.documentId };
        } else if (action === 'retry') {
          const operation = await first(
            tx,
            sql`SELECT * FROM integration_operations WHERE id=${String(input.operationId)} FOR UPDATE`,
          );
          requirePipeline(
            s(operation, 'operation_type').startsWith('pipeline.'),
            'INVALID_OPERATION',
          );
          requirePipeline(
            operation.status === 'MANUAL_ATTENTION',
            'INVALID_TRANSITION',
          );
          // Same document/idempotency key. Never create a replacement for an ambiguous submission.
          result = {
            operationId: await enqueue(
              tx,
              s(operation, 'operation_type'),
              s(operation, 'aggregate_id'),
              'pipeline.retry:' + requestKey,
            ),
          };
        }
        await tx.execute(
          sql`INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id,source,reason,metadata,correlation_id) VALUES('USER',${actorId},${'marking.' + action},'marking_pipeline',${s(result, 'shipmentId') || s(result, 'unitId') || input.requestId},'marking-pipeline',${typeof input.reason === 'string' ? input.reason : null},${JSON.stringify({ simulated: true, requestId: input.requestId })}::jsonb,${randomUUID()})`,
        );
        await tx.execute(
          sql`INSERT INTO marking_command_results(actor_id,request_id,fingerprint,result) VALUES(${actorId},${input.requestId},${fingerprint},${JSON.stringify(result)}::jsonb)`,
        );
        return { ok: true, simulated: true, replayed: false, result };
      });
    },
    async read(kind, id, offset, mode) {
      let data: unknown;
      if (kind === 'export') {
        requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
        const artifact = await first(
          db,
          sql`SELECT a.*,t.status AS signing_status,t.signature_ciphertext,t.signature_key_id,t.signature_identity_hash,t.verification_source,d.status AS document_status,d.external_document_id FROM marking_document_artifacts a JOIN chz_documents d ON d.id=a.document_id LEFT JOIN marking_signing_tasks t ON t.document_id=d.id WHERE a.document_id=${id!}`,
        );
        const raw = protection.decrypt(
          s(artifact, 'payload_ciphertext'),
          s(artifact, 'encryption_key_id'),
          s(artifact, 'identity_hash'),
        );
        requirePipeline(
          createHash('sha256').update(raw).digest('hex') ===
            artifact.payload_hash,
          'SIGNATURE_PAYLOAD_MISMATCH',
        );
        data = {
          documentId: id,
          documentType: artifact.document_type,
          productGroup: 'lp',
          payloadBase64: Buffer.from(raw).toString('base64'),
          payloadHash: artifact.payload_hash,
          signingStatus: artifact.signing_status,
          verificationSource: artifact.verification_source,
          documentStatus: artifact.document_status,
          externalDocumentId: artifact.external_document_id,
          legalCompleted: false,
          ...(artifact.signature_ciphertext
            ? {
                signatureEnvelopeBase64: Buffer.from(
                  protection.decrypt(
                    s(artifact, 'signature_ciphertext'),
                    s(artifact, 'signature_key_id'),
                    s(artifact, 'signature_identity_hash'),
                  ),
                ).toString('base64'),
              }
            : {}),
        };
      } else if (kind === 'document') {
        const doc = await first(
          db,
          sql`SELECT d.*,t.status AS signing_status,t.seller_inn,t.verification_source,t.verified_at FROM chz_documents d LEFT JOIN marking_signing_tasks t ON t.document_id=d.id WHERE d.id=${id!}`,
        );
        data = {
          ...doc,
          items: await rows(
            db,
            sql`SELECT di.id,di.status,di.error_code,co.action,co.reason,co.effective_at,co.submission_due_at,m.unit_id,m.masked_code FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id JOIN unit_markings m ON m.id=co.marking_id WHERE di.document_id=${id!}`,
          ),
        };
      } else if (kind === 'unit') {
        const u = await unit(db, id!);
        data = { ...u, blockers: blockers(u, mode) };
      } else if (kind === 'shipment') {
        data = {
          ...(await shipment(db, id!)),
          items: await composition(db, id!),
        };
      } else if (kind === 'shipments')
        data = await rows(
          db,
          sql`SELECT s.*,o.external_order_id,o.status AS order_status,(SELECT count(*)::int FROM shipment_items si WHERE si.shipment_id=s.id AND si.removed_at IS NULL) AS items_count,(SELECT sum(oi.unit_price_kopecks) FROM shipment_items si JOIN sale_cycles sc ON sc.id=si.sale_cycle_id JOIN order_items oi ON oi.id=sc.order_item_id WHERE si.shipment_id=s.id AND si.removed_at IS NULL) AS sale_total_kopecks FROM shipments s JOIN orders o ON o.id=s.order_id JOIN sales_channels c ON c.id=o.channel_id WHERE c.provider='AVITO_SIMULATION' ORDER BY s.created_at DESC,s.id LIMIT 50 OFFSET ${offset}`,
        );
      else if (kind === 'documents')
        data = await rows(
          db,
          sql`SELECT d.*,(SELECT status FROM marking_signing_tasks WHERE document_id=d.id) AS signing_status,coalesce((SELECT jsonb_agg(jsonb_build_object('id',di.id,'status',di.status,'errorCode',di.error_code,'unitId',m.unit_id,'maskedCode',m.masked_code,'action',co.action,'reason',co.reason,'dueAt',co.submission_due_at)) FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id JOIN unit_markings m ON m.id=co.marking_id WHERE di.document_id=d.id),'[]'::jsonb) AS items FROM chz_documents d ORDER BY d.created_at DESC,d.id LIMIT 50 OFFSET ${offset}`,
        );
      else if (kind === 'issues')
        data = await rows(
          db,
          sql`SELECT * FROM marking_issues WHERE resolved_at IS NULL ORDER BY created_at,id LIMIT 50 OFFSET ${offset}`,
        );
      else if (kind === 'settings')
        data = await rows(
          db,
          sql`SELECT * FROM marking_pipeline_settings ORDER BY warehouse_id`,
        );
      else
        data = await first(
          db,
          sql`SELECT (SELECT count(*)::int FROM shipments WHERE status='PACKED') AS packed,(SELECT count(*)::int FROM shipments WHERE status='READY') AS ready,(SELECT count(*)::int FROM marking_issues WHERE resolved_at IS NULL) AS issues,(SELECT count(*)::int FROM chz_operations WHERE status IN ${active}) AS pending,(SELECT count(*)::int FROM marking_business_days) AS calendar_days`,
        );
      // Saved simulation evidence remains simulated even when execution is later disabled.
      return {
        mode,
        simulated: kind === 'unit' ? (data as Row).simulated === true : true,
        data,
      };
    },
    async run(operationId, mode) {
      requirePipeline(mode === 'simulation', 'LEGAL_PROVIDER_DISABLED');
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378041)`);
        const job = await first(
            tx,
            sql`SELECT * FROM integration_operations WHERE id=${operationId}`,
          ),
          type = s(job, 'operation_type'),
          id = s(job, 'aggregate_id');
        const op = await header(
          tx,
          null,
          'MARKING',
          'pipeline:worker:' + operationId + ':' + randomUUID(),
        );
        if (type === 'pipeline.check') {
          await checkUnit(tx, id, op);
          return;
        }
        if (type === 'pipeline.markings') {
          const sh = await shipment(tx, id, true);
          if (sh.status === 'CANCELLED') return;
          const items = await composition(tx, id);
          requirePipeline(
            items.every((i) => i.packed_at),
            'SHIPMENT_NOT_PACKED',
          );
          for (const item of items)
            await tx.execute(
              sql`UPDATE order_unit_assignments SET avito_marking_status='ACCEPTED',provider_confirmed_at=now(),last_operation_id=${op} WHERE id=${s(item, 'assignment_id')}`,
            );
          await tx.execute(
            sql`UPDATE shipments SET status='PACKED',last_operation_id=${op} WHERE id=${id}`,
          );
          await tx.execute(
            sql`UPDATE orders SET status='PACKED',last_operation_id=${op} WHERE id=${s(sh, 'order_id')}`,
          );
          return;
        }
        if (type === 'pipeline.sign') {
          const task = await first(
            tx,
            sql`SELECT t.*,a.payload_hash,a.payload_ciphertext,a.encryption_key_id,a.identity_hash FROM marking_signing_tasks t JOIN marking_document_artifacts a ON a.document_id=t.document_id WHERE t.document_id=${id} FOR UPDATE OF t`,
          );
          requirePipeline(
            task.simulated === true,
            'SIGNATURE_VERIFICATION_UNAVAILABLE',
          );
          requirePipeline(protection, 'MARKING_STORAGE_NOT_CONFIGURED');
          if (task.status === 'VERIFIED') return;
          requirePipeline(
            task.status === 'PENDING' ||
              (task.status === 'LEASED' &&
                Date.parse(s(task, 'lease_expires_at')) < Date.now()),
            'SIGNER_LEASE_ACTIVE',
          );
          const raw = protection.decrypt(
            s(task, 'payload_ciphertext'),
            s(task, 'encryption_key_id'),
            s(task, 'identity_hash'),
          );
          const payloadHash = createHash('sha256').update(raw).digest('hex');
          requirePipeline(
            payloadHash === task.payload_hash,
            'SIGNATURE_PAYLOAD_MISMATCH',
          );
          const mockSignature = JSON.stringify({
            type: 'SIMULATION_ONLY_NOT_UKEP',
            payloadHash,
            sellerInn: task.seller_inn,
          });
          const encrypted = protection.encrypt(
            mockSignature,
            'signature:' + s(task, 'id'),
          );
          await tx.execute(
            sql`UPDATE marking_signing_tasks SET status='VERIFIED',signature_ciphertext=${encrypted.payloadCiphertext},signature_key_id=${encrypted.encryptionKeyId},signature_identity_hash=${encrypted.identityHash},signature_hash=${createHash('sha256').update(mockSignature).digest('hex')},verified_payload_hash=${payloadHash},verification_source='SIMULATION',received_at=now(),verified_at=now() WHERE id=${s(task, 'id')}`,
          );
          await enqueue(tx, 'pipeline.document', id, 'pipeline.signed:' + id);
          return;
        }
        requirePipeline(type === 'pipeline.document', 'INVALID_OPERATION');
        const document = await first(
          tx,
          sql`SELECT * FROM chz_documents WHERE id=${id} FOR UPDATE`,
        );
        if (document.status === 'CONFIRMED') return;
        const items = await rows(
          tx,
          sql`SELECT di.id AS item_id,di.status AS item_status,co.*,m.unit_id FROM chz_document_items di JOIN chz_operations co ON co.id=di.chz_operation_id JOIN unit_markings m ON m.id=co.marking_id WHERE di.document_id=${id} ORDER BY m.unit_id`,
        );
        const signature = await first(
          tx,
          sql`SELECT t.status,t.simulated,t.verified_payload_hash,t.verification_source,a.payload_hash FROM marking_signing_tasks t JOIN marking_document_artifacts a ON a.document_id=t.document_id WHERE t.document_id=${id}`,
        );
        if (signature.status !== 'VERIFIED') {
          if (document.status !== 'WAITING_SIGNATURE') {
            await tx.execute(
              sql`UPDATE chz_documents SET status='WAITING_SIGNATURE',last_operation_id=${op} WHERE id=${id}`,
            );
            for (const item of items) {
              await tx.execute(
                sql`UPDATE chz_operations SET status='WAITING_SIGNATURE',last_operation_id=${op} WHERE id=${s(item, 'id')}`,
              );
              await tx.execute(
                sql`UPDATE chz_document_items SET status='WAITING_SIGNATURE',last_operation_id=${op} WHERE id=${s(item, 'item_id')}`,
              );
            }
          }
          if (signature.status === 'PENDING')
            await enqueue(tx, 'pipeline.sign', id, 'pipeline.sign:' + id);
          return;
        }
        requirePipeline(
          signature.simulated === true &&
            signature.verification_source === 'SIMULATION' &&
            signature.verified_payload_hash === signature.payload_hash,
          'SIGNATURE_PAYLOAD_MISMATCH',
        );
        let external = (
          await rows(
            tx,
            sql`SELECT * FROM marking_simulation_documents WHERE document_id=${id}`,
          )
        )[0];
        if (!external) {
          const outcomes: Record<string, string> = {};
          for (const item of items) {
            const fact = (
              await rows(
                tx,
                sql`SELECT * FROM marking_simulation_units WHERE unit_id=${s(item, 'unit_id')}`,
              )
            )[0];
            outcomes[s(item, 'unit_id')] = fact
              ? s(fact, 'outcome')
              : 'REJECTED';
          }
          external = await first(
            tx,
            sql`INSERT INTO marking_simulation_documents(document_id,payload_hash,items) VALUES(${id},${s(document, 'payload_hash')},${JSON.stringify(outcomes)}::jsonb) RETURNING *`,
          );
          await tx.execute(
            sql`UPDATE chz_documents SET status='PROCESSING',external_document_id=${s(external, 'external_id')},submitted_at=now(),last_operation_id=${op} WHERE id=${id}`,
          );
          for (const item of items) {
            await tx.execute(
              sql`UPDATE chz_operations SET status='PROCESSING',last_operation_id=${op} WHERE id=${s(item, 'id')}`,
            );
            await tx.execute(
              sql`UPDATE chz_document_items SET status='PROCESSING',last_operation_id=${op} WHERE id=${s(item, 'item_id')}`,
            );
          }
          await enqueue(tx, 'pipeline.document', id, 'pipeline.poll:' + id);
          return;
        }
        // Poll/readback is durable and separate from submission. Already accepted items are skipped.
        const outcomes = external.items as Record<string, string>;
        let allConfirmed = true;
        for (const item of items) {
          if (item.item_status === 'CONFIRMED') continue;
          const outcome = outcomes[s(item, 'unit_id')];
          const fact = await first(
            tx,
            sql`SELECT f.*,st.seller_inn FROM marking_simulation_units f JOIN marking_pipeline_settings st ON st.warehouse_id=${s(document, 'warehouse_id')}::uuid WHERE f.unit_id=${s(item, 'unit_id')}`,
          );
          if (outcome === 'AMBIGUOUS' && item.status !== 'UNKNOWN_RESULT') {
            await tx.execute(
              sql`UPDATE chz_operations SET status='UNKNOWN_RESULT',last_operation_id=${op} WHERE id=${s(item, 'id')}`,
            );
            await tx.execute(
              sql`UPDATE chz_document_items SET status='UNKNOWN_RESULT',last_operation_id=${op} WHERE id=${s(item, 'item_id')}`,
            );
            await enqueue(
              tx,
              'pipeline.document',
              id,
              'pipeline.reconcile:' + id,
            );
            allConfirmed = false;
            continue;
          }
          const state = ['RETURN', 'CORRECT'].includes(s(item, 'action'))
            ? 'INTRODUCED'
            : 'RETIRED';
          if (
            outcome === 'REJECTED' ||
            outcome === 'STATE_MISMATCH' ||
            fact.owner_inn !== fact.seller_inn
          ) {
            const status =
              outcome === 'REJECTED' ? 'REJECTED' : 'MANUAL_ATTENTION';
            await tx.execute(
              sql`UPDATE chz_operations SET status=${status}::chz_progress,last_operation_id=${op} WHERE id=${s(item, 'id')}`,
            );
            await tx.execute(
              sql`UPDATE chz_document_items SET status=${status}::chz_progress,error_code=${'SIMULATED_' + outcome},last_operation_id=${op} WHERE id=${s(item, 'item_id')}`,
            );
            await issue(tx, 'DOCUMENT_' + outcome, s(item, 'unit_id'), {
              documentId: id,
            });
            allConfirmed = false;
            continue;
          }
          await tx.execute(
            sql`UPDATE marking_simulation_units SET provider_state=${state},updated_at=now() WHERE unit_id=${s(item, 'unit_id')}`,
          );
          await tx.execute(
            sql`INSERT INTO unit_marking_events(marking_id,state,provider_state,source,source_event_id,ownership_verified,chz_document_item_id,operation_id,observed_at) VALUES(${s(item, 'marking_id')},${['RETURN', 'CORRECT'].includes(s(item, 'action')) ? 'IN_CIRCULATION' : 'WITHDRAWN'}::chz_legal_state,${state},'SIMULATION',${id + ':' + s(item, 'item_id')},'VERIFIED',${s(item, 'item_id')},${op},now()) ON CONFLICT(source,source_event_id) DO NOTHING`,
          );
          await tx.execute(
            sql`UPDATE chz_operations SET status='CONFIRMED',confirmed_at=now(),last_operation_id=${op} WHERE id=${s(item, 'id')}`,
          );
          await tx.execute(
            sql`UPDATE chz_document_items SET status='CONFIRMED',error_code=NULL,last_operation_id=${op} WHERE id=${s(item, 'item_id')}`,
          );
          await resolve(tx, s(item, 'unit_id'), [
            'DOCUMENT_REJECTED',
            'DOCUMENT_STATE_MISMATCH',
          ]);
          if (['RETURN', 'CORRECT'].includes(s(item, 'action')))
            await releaseReturn(
              tx,
              s(item, 'unit_id'),
              s(item, 'sale_cycle_id'),
              s(item, 'return_id') || null,
              s(document, 'warehouse_id'),
            );
        }
        await tx.execute(
          sql`UPDATE chz_documents SET status=${allConfirmed ? 'CONFIRMED' : 'MANUAL_ATTENTION'}::chz_progress,processed_at=now(),last_operation_id=${op} WHERE id=${id}`,
        );
        if (allConfirmed && document.action === 'WITHDRAW') {
          const shipmentId = s(items[0]!, 'shipment_id'),
            sh = await shipment(tx, shipmentId, true);
          if (
            sh.status === 'PACKED' &&
            !(
              await rows(
                tx,
                sql`SELECT id FROM chz_operations WHERE shipment_id=${shipmentId} AND action='WITHDRAW' AND status<>'CONFIRMED'`,
              )
            ).length
          ) {
            await tx.execute(
              sql`UPDATE shipments SET status='READY',last_operation_id=${op} WHERE id=${shipmentId}`,
            );
            await tx.execute(
              sql`UPDATE orders SET status='READY_TO_SHIP',last_operation_id=${op} WHERE id=${s(sh, 'order_id')}`,
            );
          }
        }
      });
    },
    async reconcile(mode) {
      if (mode !== 'simulation') return;
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(19378041)`);
        for (const co of await rows(
          tx,
          sql`SELECT co.id,co.submission_due_at,co.shipment_id,co.status FROM chz_operations co WHERE co.submission_due_at<now() AND (co.status<>'CONFIRMED' OR co.confirmed_at>co.submission_due_at)`,
        ))
          await issue(tx, 'LEGAL_DEADLINE_EXCEEDED', s(co, 'id'), {
            shipmentId: co.shipment_id,
            dueAt: s(co, 'submission_due_at'),
          });
        for (const job of await rows(
          tx,
          sql`SELECT id,operation_type,last_error_code FROM integration_operations WHERE operation_type LIKE 'pipeline.%' AND status='MANUAL_ATTENTION'`,
        ))
          await issue(tx, 'JOB_FAILED', s(job, 'id'), {
            operationType: job.operation_type,
            errorCode: job.last_error_code,
          });
        for (const sh of await rows(
          tx,
          sql`SELECT id FROM shipments WHERE prepared_at<now()-interval '30 minutes' AND handed_over_at IS NULL AND status<>'CANCELLED'`,
        ))
          await issue(tx, 'PREPARED_NOT_HANDED_OVER', s(sh, 'id'));
      });
    },
  };
}
async function releaseReturn(
  tx: Tx,
  unitId: string,
  cycleId: string,
  returnId: string | null,
  warehouseId: string,
) {
  const u = await unit(tx, unitId, true);
  requirePipeline(u.current_state === 'QUARANTINE', 'INVALID_TRANSITION');
  const op = await header(
    tx,
    null,
    'RELEASE',
    'pipeline:release:' + unitId + ':' + randomUUID(),
  );
  await movement(
    tx,
    u,
    op,
    'AVAILABLE',
    await location(tx, warehouseId, 'SELLABLE'),
  );
  await tx.execute(
    sql`UPDATE sale_cycles SET closed_at=now(),close_reason=${returnId ? 'RETURNED' : 'CANCELLED'},last_operation_id=${op} WHERE id=${cycleId}`,
  );
  if (returnId)
    await tx.execute(
      sql`UPDATE returns SET status='COMPLETED',last_operation_id=${op} WHERE id=${returnId}`,
    );
}
