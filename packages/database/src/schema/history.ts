import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  inventoryCounts,
  inventoryOperations,
  physicalStateEnum,
  productUnits,
  stockLocations,
  stockReceipts,
  unitMarkings,
} from './stock.js';
import { returnItems, returns, shipmentItems, shipments } from './sales.js';
import { entityId, recordedAt } from './common.js';

export const inventoryScans = pgTable(
  'inventory_scans',
  {
    id: entityId(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    receiptId: uuid('receipt_id').references(() => stockReceipts.id),
    shipmentId: uuid('shipment_id').references(() => shipments.id),
    returnId: uuid('return_id').references(() => returns.id),
    countId: uuid('count_id').references(() => inventoryCounts.id),
    unitId: uuid('unit_id').references(() => productUnits.id),
    markingId: uuid('marking_id').references(() => unitMarkings.id),
    result: text('result').notNull(),
    errorCode: text('error_code'),
    scannerProfile: text('scanner_profile').notNull(),
    inputFingerprint: text('input_fingerprint').notNull(),
    recordedAt: recordedAt(),
  },
  (t) => [
    check(
      'inventory_scan_context_check',
      sql`num_nonnulls(${t.receiptId},${t.shipmentId},${t.returnId},${t.countId}) = 1`,
    ),
    check(
      'inventory_scan_result_check',
      sql`${t.result} IN ('ACCEPTED','DUPLICATE','INVALID','UNKNOWN','MISMATCH')`,
    ),
    check(
      'inventory_scan_fingerprint_check',
      sql`${t.inputFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    index('inventory_scans_unit_time_idx').on(t.unitId, t.recordedAt),
  ],
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: bigint('id', { mode: 'bigint' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => productUnits.id),
    unitRevision: integer('unit_revision').notNull(),
    fromState: physicalStateEnum('from_state').notNull(),
    toState: physicalStateEnum('to_state').notNull(),
    fromLocationId: uuid('from_location_id').references(
      () => stockLocations.id,
    ),
    toLocationId: uuid('to_location_id').references(() => stockLocations.id),
    shipmentItemId: uuid('shipment_item_id'),
    returnItemId: uuid('return_item_id'),
    countId: uuid('count_id').references(() => inventoryCounts.id),
    reversesMovementId: bigint('reverses_movement_id', {
      mode: 'bigint',
    }).references((): AnyPgColumn => inventoryMovements.id),
    recordedAt: recordedAt(),
  },
  (t) => [
    unique('inventory_movements_unit_revision_uq').on(t.unitId, t.unitRevision),
    unique('inventory_movements_operation_unit_uq').on(t.operationId, t.unitId),
    unique('inventory_movements_reversal_uq').on(t.reversesMovementId),
    foreignKey({
      name: 'movements_shipment_unit_fk',
      columns: [t.shipmentItemId, t.unitId],
      foreignColumns: [shipmentItems.id, shipmentItems.unitId],
    }),
    foreignKey({
      name: 'movements_return_unit_fk',
      columns: [t.returnItemId, t.unitId],
      foreignColumns: [returnItems.id, returnItems.unitId],
    }),
    index('inventory_movements_unit_time_idx').on(t.unitId, t.recordedAt),
    check('movement_revision_check', sql`${t.unitRevision} > 0`),
    check(
      'movement_changes_check',
      sql`${t.fromState} <> ${t.toState} OR ${t.fromLocationId} IS DISTINCT FROM ${t.toLocationId}`,
    ),
  ],
);

// Sanitized workflow history, automatically appended by database triggers.
export const inventoryEvents = pgTable(
  'inventory_events',
  {
    id: bigint('id', { mode: 'bigint' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    previousStatus: text('previous_status'),
    nextStatus: text('next_status'),
    details: jsonb('details')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    recordedAt: recordedAt(),
  },
  (t) => [
    index('inventory_events_entity_idx').on(t.entityType, t.entityId, t.id),
    index('inventory_events_operation_idx').on(t.operationId),
  ],
);
