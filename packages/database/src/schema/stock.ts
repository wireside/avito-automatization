import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './foundation.js';
import {
  counterparties,
  dataSourceEnum,
  productVariants,
  variantIdentifiers,
} from './catalog.js';
import { entityId, recordedAt, timestamps } from './common.js';

export const locationKindEnum = pgEnum('stock_location_kind', [
  'SELLABLE',
  'QUARANTINE',
  'DEFECT',
  'STAGING',
]);
export const physicalStateEnum = pgEnum('unit_physical_state', [
  'NOT_RECEIVED',
  'QUARANTINE',
  'AVAILABLE',
  'PACKING',
  'IN_TRANSIT',
  'WITH_CUSTOMER',
  'RETURN_IN_TRANSIT',
  'DEFECTIVE',
  'LOST',
  'DISPOSED',
  'WITH_SUPPLIER',
]);
export const receiptStatusEnum = pgEnum('stock_receipt_status', [
  'DRAFT',
  'POSTED',
  'REVERSED',
]);
export const documentVerificationEnum = pgEnum('document_verification', [
  'PENDING',
  'VERIFIED',
  'REJECTED',
]);
export const inventoryOperationKindEnum = pgEnum('inventory_operation_kind', [
  'RECEIPT',
  'RELEASE',
  'RESERVE',
  'RELEASE_RESERVATION',
  'PACK',
  'UNPACK',
  'PREPARE_SHIPMENT',
  'SHIP',
  'DELIVER',
  'START_RETURN',
  'RETURN',
  'TRANSFER',
  'DEFECT',
  'LOSS',
  'DISPOSE',
  'SUPPLIER_RETURN',
  'COUNT',
  'CORRECTION',
  'COST_UPDATE',
  'MARKING',
  'OTHER',
]);

export const workShifts = pgTable(
  'work_shifts',
  {
    id: entityId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('work_shifts_open_user_uidx')
      .on(t.userId)
      .where(sql`${t.closedAt} IS NULL`),
    check(
      'work_shifts_dates_check',
      sql`${t.closedAt} IS NULL OR ${t.closedAt} >= ${t.openedAt}`,
    ),
  ],
);

export const warehouses = pgTable('warehouses', {
  id: entityId(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  fiasId: uuid('fias_id'),
  address: text('address'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps(),
});
export const stockLocations = pgTable(
  'stock_locations',
  {
    id: entityId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: locationKindEnum('kind').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('stock_locations_code_uq').on(t.warehouseId, t.code),
    unique('stock_locations_id_warehouse_uq').on(t.id, t.warehouseId),
  ],
);

// Append-only operation header: a business action can contain several movements/events.
export const inventoryOperations = pgTable(
  'inventory_operations',
  {
    id: entityId(),
    kind: inventoryOperationKindEnum('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    actorKind: text('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    shiftId: uuid('shift_id').references(() => workShifts.id),
    source: text('source').notNull(),
    reason: text('reason'),
    correlationId: uuid('correlation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: recordedAt(),
  },
  (t) => [
    check(
      'inventory_actor_check',
      sql`(${t.actorKind} = 'USER' AND ${t.actorUserId} IS NOT NULL) OR (${t.actorKind} IN ('SYSTEM', 'IMPORT') AND ${t.actorUserId} IS NULL)`,
    ),
    check(
      'inventory_reason_check',
      sql`${t.kind} NOT IN ('CORRECTION', 'LOSS', 'DISPOSE', 'DEFECT') OR length(btrim(${t.reason})) > 0 AND ${t.reason} IS NOT NULL`,
    ),
    index('inventory_operations_time_idx').on(t.occurredAt),
    index('inventory_operations_correlation_idx').on(t.correlationId),
  ],
);

export const supplyDocuments = pgTable(
  'supply_documents',
  {
    id: entityId(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => counterparties.id),
    source: dataSourceEnum('source').notNull(),
    sourceReference: text('source_reference').notNull(),
    revision: integer('revision').default(1).notNull(),
    number: text('number'),
    documentAt: timestamp('document_at', { withTimezone: true }),
    verificationStatus: documentVerificationEnum('verification_status')
      .default('PENDING')
      .notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    contentHash: varchar('content_hash', { length: 64 }),
    storageKey: text('storage_key'),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('supply_documents_source_revision_uq').on(
      t.source,
      t.sourceReference,
      t.revision,
    ),
    check('supply_documents_revision_check', sql`${t.revision} > 0`),
    check(
      'supply_documents_verified_check',
      sql`${t.verificationStatus} <> 'VERIFIED' OR ${t.verifiedAt} IS NOT NULL`,
    ),
  ],
);
export const supplyDocumentItems = pgTable(
  'supply_document_items',
  {
    id: entityId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => supplyDocuments.id),
    lineKey: text('line_key').notNull(),
    variantId: uuid('variant_id').references(() => productVariants.id),
    supplierArticle: text('supplier_article'),
    supplierName: text('supplier_name').notNull(),
    quantity: integer('quantity').notNull(),
    unitCostKopecks: bigint('unit_cost_kopecks', { mode: 'bigint' }),
    taxTreatment: text('tax_treatment').notNull(),
    currency: varchar('currency', { length: 3 }).default('RUB').notNull(),
  },
  (t) => [
    unique('supply_document_line_uq').on(t.documentId, t.lineKey),
    check('supply_document_quantity_check', sql`${t.quantity} > 0`),
    check(
      'supply_document_cost_check',
      sql`${t.unitCostKopecks} IS NULL OR ${t.unitCostKopecks} >= 0`,
    ),
    check('supply_document_currency_check', sql`${t.currency} = 'RUB'`),
  ],
);

export const stockReceipts = pgTable(
  'stock_receipts',
  {
    id: entityId(),
    number: text('number').notNull().unique(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    supplierId: uuid('supplier_id').references(() => counterparties.id),
    supplyDocumentId: uuid('supply_document_id').references(
      () => supplyDocuments.id,
    ),
    status: receiptStatusEnum('status').default('DRAFT').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('stock_receipts_id_warehouse_uq').on(t.id, t.warehouseId),
    check(
      'receipt_posted_time_check',
      sql`${t.status} = 'DRAFT' OR ${t.postedAt} IS NOT NULL`,
    ),
  ],
);
export const stockReceiptItems = pgTable(
  'stock_receipt_items',
  {
    id: entityId(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => stockReceipts.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    supplyDocumentItemId: uuid('supply_document_item_id').references(
      () => supplyDocumentItems.id,
    ),
    expectedQuantity: integer('expected_quantity').notNull(),
  },
  (t) => [
    unique('receipt_items_id_variant_uq').on(t.id, t.variantId),
    index('receipt_items_receipt_idx').on(t.receiptId),
    check('receipt_items_quantity_check', sql`${t.expectedQuantity} > 0`),
  ],
);
export const costLayers = pgTable(
  'cost_layers',
  {
    id: entityId(),
    receiptItemId: uuid('receipt_item_id').notNull().unique(),
    variantId: uuid('variant_id').notNull(),
    recordedAt: recordedAt(),
  },
  (t) => [
    unique('cost_layers_id_variant_uq').on(t.id, t.variantId),
    foreignKey({
      name: 'cost_layers_receipt_variant_fk',
      columns: [t.receiptItemId, t.variantId],
      foreignColumns: [stockReceiptItems.id, stockReceiptItems.variantId],
    }),
  ],
);

// Append-only selected purchase cost revisions. Missing evidence is NULL/no revision, not zero.
export const costLayerPrices = pgTable(
  'cost_layer_prices',
  {
    id: entityId(),
    costLayerId: uuid('cost_layer_id')
      .notNull()
      .references(() => costLayers.id),
    revision: integer('revision').notNull(),
    unitCostKopecks: bigint('unit_cost_kopecks', { mode: 'bigint' }).notNull(),
    source: dataSourceEnum('source').notNull(),
    sourceReference: text('source_reference').notNull(),
    supplyDocumentItemId: uuid('supply_document_item_id').references(
      () => supplyDocumentItems.id,
    ),
    taxTreatment: text('tax_treatment').notNull(),
    currency: varchar('currency', { length: 3 }).default('RUB').notNull(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    recordedAt: recordedAt(),
  },
  (t) => [
    unique('cost_layer_price_revision_uq').on(t.costLayerId, t.revision),
    check(
      'cost_layer_price_check',
      sql`${t.revision} > 0 AND ${t.unitCostKopecks} >= 0 AND ${t.currency} = 'RUB'`,
    ),
    index('cost_layer_prices_operation_idx').on(t.operationId),
  ],
);

// current_* is a rebuildable ledger projection maintained by the movement trigger.
export const productUnits = pgTable(
  'product_units',
  {
    id: entityId(),
    internalCode: text('internal_code').notNull().unique(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    costLayerId: uuid('cost_layer_id').notNull(),
    currentState: physicalStateEnum('current_state')
      .default('NOT_RECEIVED')
      .notNull(),
    currentLocationId: uuid('current_location_id').references(
      () => stockLocations.id,
    ),
    movementRevision: integer('movement_revision').default(0).notNull(),
    createdByOperationId: uuid('created_by_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('product_units_id_variant_uq').on(t.id, t.variantId),
    foreignKey({
      name: 'product_units_cost_variant_fk',
      columns: [t.costLayerId, t.variantId],
      foreignColumns: [costLayers.id, costLayers.variantId],
    }),
    index('product_units_position_idx').on(
      t.currentLocationId,
      t.variantId,
      t.currentState,
    ),
    check('product_units_revision_check', sql`${t.movementRevision} >= 0`),
    check(
      'product_units_location_check',
      sql`(${t.currentState} IN ('AVAILABLE', 'PACKING', 'QUARANTINE', 'DEFECTIVE')) = (${t.currentLocationId} IS NOT NULL)`,
    ),
  ],
);

export const unitMarkings = pgTable(
  'unit_markings',
  {
    id: entityId(),
    unitId: uuid('unit_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    variantIdentifierId: uuid('variant_identifier_id').notNull(),
    identityHash: varchar('identity_hash', { length: 64 }).notNull().unique(),
    maskedCode: text('masked_code').notNull(),
    payloadCiphertext: text('payload_ciphertext').notNull(),
    encryptionKeyId: text('encryption_key_id').notNull(),
    parserProfile: text('parser_profile').notNull(),
    scannerProfile: text('scanner_profile').notNull(),
    supersedesMarkingId: uuid('supersedes_marking_id').references(
      (): AnyPgColumn => unitMarkings.id,
    ),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'unit_markings_unit_variant_fk',
      columns: [t.unitId, t.variantId],
      foreignColumns: [productUnits.id, productUnits.variantId],
    }),
    foreignKey({
      name: 'unit_markings_gtin_variant_fk',
      columns: [t.variantIdentifierId, t.variantId],
      foreignColumns: [variantIdentifiers.id, variantIdentifiers.variantId],
    }),
    uniqueIndex('unit_markings_active_unit_uidx')
      .on(t.unitId)
      .where(sql`${t.retiredAt} IS NULL`),
    uniqueIndex('unit_markings_replacement_uidx').on(t.supersedesMarkingId),
    check(
      'unit_markings_hash_check',
      sql`${t.identityHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'unit_markings_payload_check',
      sql`length(${t.payloadCiphertext}) > 0 AND length(${t.encryptionKeyId}) > 0`,
    ),
  ],
);

export const inventoryCounts = pgTable(
  'inventory_counts',
  {
    id: entityId(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    locationId: uuid('location_id'),
    status: text('status').default('OPEN').notNull(),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'inventory_counts_location_warehouse_fk',
      columns: [t.locationId, t.warehouseId],
      foreignColumns: [stockLocations.id, stockLocations.warehouseId],
    }),
    check(
      'inventory_counts_status_check',
      sql`${t.status} IN ('OPEN', 'REVIEW', 'POSTED', 'CANCELLED')`,
    ),
  ],
);
export const inventoryCountItems = pgTable(
  'inventory_count_items',
  {
    id: entityId(),
    countId: uuid('count_id')
      .notNull()
      .references(() => inventoryCounts.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => productUnits.id),
    expected: boolean('expected').notNull(),
    expectedLocationId: uuid('expected_location_id').references(
      () => stockLocations.id,
    ),
    expectedState: physicalStateEnum('expected_state'),
    expectedMovementRevision: integer('expected_movement_revision'),
    countedLocationId: uuid('counted_location_id').references(
      () => stockLocations.id,
    ),
    countedAt: timestamp('counted_at', { withTimezone: true }),
    countedBy: uuid('counted_by').references(() => users.id),
    resolutionReason: text('resolution_reason'),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('inventory_count_unit_uq').on(t.countId, t.unitId),
    check(
      'inventory_count_snapshot_check',
      sql`NOT ${t.expected} OR (${t.expectedState} IS NOT NULL AND ${t.expectedMovementRevision} IS NOT NULL)`,
    ),
  ],
);
