import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { integrationOperations } from './foundation.js';
import { inventoryOperations, unitMarkings, warehouses } from './stock.js';
import { returns, saleCycles, shipments } from './sales.js';
import { entityId, recordedAt, timestamps } from './common.js';

export const chzLegalStateEnum = pgEnum('chz_legal_state', [
  'UNKNOWN',
  'IN_CIRCULATION',
  'WITHDRAWN',
  'WRITTEN_OFF',
  'OTHER',
]);
export const chzModeEnum = pgEnum('chz_submission_mode', [
  'AVITO_OFD',
  'CHZ_MANUAL',
  'DIRECT_TRUE_API',
]);
export const chzActionEnum = pgEnum('chz_action', [
  'WITHDRAW',
  'RETURN',
  'WRITE_OFF',
  'REMARK',
  'CORRECT',
]);
export const chzProgressEnum = pgEnum('chz_progress', [
  'PREPARING',
  'WAITING_SIGNATURE',
  'SUBMITTED',
  'PROCESSING',
  'CONFIRMED',
  'REJECTED',
  'UNKNOWN_RESULT',
  'MANUAL_ATTENTION',
  'CANCELLED',
]);

export const chzOperations = pgTable(
  'chz_operations',
  {
    id: entityId(),
    markingId: uuid('marking_id')
      .notNull()
      .references(() => unitMarkings.id),
    action: chzActionEnum('action').notNull(),
    reason: text('reason').notNull(),
    saleCycleId: uuid('sale_cycle_id').references(() => saleCycles.id),
    shipmentId: uuid('shipment_id').references(() => shipments.id),
    returnId: uuid('return_id').references(() => returns.id),
    submissionMode: chzModeEnum('submission_mode').notNull(),
    status: chzProgressEnum('status').default('PREPARING').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    integrationOperationId: uuid('integration_operation_id').references(
      () => integrationOperations.id,
    ),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    submissionDueAt: timestamp('submission_due_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('chz_operations_sale_action_uq').on(
      t.markingId,
      t.saleCycleId,
      t.action,
    ),
    index('chz_operations_deadline_idx').on(t.status, t.submissionDueAt),
    uniqueIndex('chz_operations_pending_marking_uidx')
      .on(t.markingId)
      .where(
        sql`${t.status} IN ('PREPARING', 'WAITING_SIGNATURE', 'SUBMITTED', 'PROCESSING', 'UNKNOWN_RESULT', 'MANUAL_ATTENTION')`,
      ),
    check(
      'chz_sale_cycle_check',
      sql`${t.action} NOT IN ('WITHDRAW', 'RETURN') OR ${t.saleCycleId} IS NOT NULL`,
    ),
    check(
      'chz_confirmation_check',
      sql`${t.status} <> 'CONFIRMED' OR ${t.confirmedAt} IS NOT NULL`,
    ),
  ],
);
export const chzDocuments = pgTable(
  'chz_documents',
  {
    id: entityId(),
    submissionMode: chzModeEnum('submission_mode').notNull(),
    externalDocumentId: text('external_document_id'),
    action: chzActionEnum('action').notNull(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id),
    schemaVersion: text('schema_version').notNull(),
    payloadHash: text('payload_hash'),
    status: chzProgressEnum('status').default('PREPARING').notNull(),
    providerStatus: text('provider_status'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('chz_documents_external_uq').on(
      t.submissionMode,
      t.externalDocumentId,
    ),
  ],
);
export const chzDocumentItems = pgTable(
  'chz_document_items',
  {
    id: entityId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => chzDocuments.id),
    chzOperationId: uuid('chz_operation_id')
      .notNull()
      .references(() => chzOperations.id),
    status: chzProgressEnum('status').default('PREPARING').notNull(),
    errorCode: text('error_code'),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('chz_document_operation_uq').on(t.documentId, t.chzOperationId),
  ],
);

// Append-only provider observations; ordering is observed_at then id, not job arrival time.
export const unitMarkingEvents = pgTable(
  'unit_marking_events',
  {
    id: bigint('id', { mode: 'bigint' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    markingId: uuid('marking_id')
      .notNull()
      .references(() => unitMarkings.id),
    state: chzLegalStateEnum('state').notNull(),
    providerState: text('provider_state').notNull(),
    source: text('source').notNull(),
    sourceEventId: text('source_event_id').notNull(),
    ownershipVerified: text('ownership_verified').notNull(),
    chzDocumentItemId: uuid('chz_document_item_id').references(
      () => chzDocumentItems.id,
    ),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    recordedAt: recordedAt(),
  },
  (t) => [
    unique('marking_events_source_uq').on(t.source, t.sourceEventId),
    index('marking_events_latest_idx').on(t.markingId, t.observedAt, t.id),
    check(
      'marking_events_ownership_check',
      sql`${t.ownershipVerified} IN ('UNKNOWN', 'VERIFIED', 'REJECTED')`,
    ),
  ],
);
