import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { photoGroups, products, productVariants } from './catalog.js';
import {
  costLayerPrices,
  inventoryOperations,
  productUnits,
  warehouses,
} from './stock.js';
import { entityId, timestamps } from './common.js';

export const orderStatusEnum = pgEnum('warehouse_order_status', [
  'NEW',
  'MAPPING_REQUIRED',
  'RESERVED',
  'PICKING',
  'MARKING_PENDING',
  'PACKED',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURN_IN_TRANSIT',
  'RETURNED',
  'ERROR',
]);
export const reservationStatusEnum = pgEnum('inventory_reservation_status', [
  'ACTIVE',
  'RELEASED',
  'CONSUMED',
]);
export const avitoMarkingStatusEnum = pgEnum('avito_marking_status', [
  'NOT_REQUIRED',
  'NOT_SENT',
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'UNKNOWN_RESULT',
]);

export const salesChannels = pgTable(
  'sales_channels',
  {
    id: entityId(),
    provider: text('provider').default('AVITO').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    name: text('name').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('sales_channels_account_uq').on(t.provider, t.externalAccountId),
  ],
);
export const avitoItems = pgTable(
  'avito_items',
  {
    id: entityId(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => salesChannels.id),
    externalItemId: text('external_item_id'),
    externalKey: text('external_key').notNull(),
    productId: uuid('product_id').references(() => products.id),
    photoGroupId: uuid('photo_group_id').references(() => photoGroups.id),
    title: text('title').notNull(),
    providerStatus: text('provider_status'),
    contentRevision: integer('content_revision').default(1).notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('avito_items_external_id_uq').on(t.channelId, t.externalItemId),
    unique('avito_items_external_key_uq').on(t.channelId, t.externalKey),
    unique('avito_items_id_channel_uq').on(t.id, t.channelId),
    check('avito_items_revision_check', sql`${t.contentRevision} > 0`),
  ],
);
export const avitoItemVariants = pgTable(
  'avito_item_variants',
  {
    id: entityId(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => avitoItems.id),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    externalVariantKey: text('external_variant_key'),
    allocationLimit: integer('allocation_limit'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('avito_item_variant_active_uidx')
      .on(t.itemId, t.variantId)
      .where(sql`${t.archivedAt} IS NULL`),
    check(
      'avito_item_allocation_check',
      sql`${t.allocationLimit} IS NULL OR ${t.allocationLimit} >= 0`,
    ),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: entityId(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => salesChannels.id),
    externalOrderId: text('external_order_id').notNull(),
    status: orderStatusEnum('status').default('NEW').notNull(),
    providerStatus: text('provider_status').notNull(),
    availableActions: jsonb('available_actions')
      .$type<string[]>()
      .default([])
      .notNull(),
    orderedAt: timestamp('ordered_at', { withTimezone: true }).notNull(),
    providerUpdatedAt: timestamp('provider_updated_at', {
      withTimezone: true,
    }).notNull(),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('orders_channel_external_uq').on(t.channelId, t.externalOrderId),
    unique('orders_id_channel_uq').on(t.id, t.channelId),
    index('orders_status_time_idx').on(t.status, t.orderedAt),
  ],
);
export const orderItems = pgTable(
  'order_items',
  {
    id: entityId(),
    orderId: uuid('order_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    externalLineKey: text('external_line_key').notNull(),
    listingId: uuid('listing_id'),
    variantId: uuid('variant_id').references(() => productVariants.id),
    titleSnapshot: text('title_snapshot').notNull(),
    variantSnapshot: jsonb('variant_snapshot')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceKopecks: bigint('unit_price_kopecks', { mode: 'bigint' }),
    mappingStatus: text('mapping_status').default('REQUIRED').notNull(),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'order_items_order_channel_fk',
      columns: [t.orderId, t.channelId],
      foreignColumns: [orders.id, orders.channelId],
    }),
    foreignKey({
      name: 'order_items_listing_channel_fk',
      columns: [t.listingId, t.channelId],
      foreignColumns: [avitoItems.id, avitoItems.channelId],
    }),
    unique('order_items_line_uq').on(t.orderId, t.externalLineKey),
    unique('order_items_id_variant_uq').on(t.id, t.variantId),
    unique('order_items_id_order_uq').on(t.id, t.orderId),
    check(
      'order_items_quantity_check',
      sql`${t.quantity} > 0 AND (${t.unitPriceKopecks} IS NULL OR ${t.unitPriceKopecks} >= 0)`,
    ),
    check(
      'order_items_mapping_check',
      sql`(${t.mappingStatus} = 'REQUIRED' AND ${t.variantId} IS NULL) OR (${t.mappingStatus} = 'VERIFIED' AND ${t.variantId} IS NOT NULL)`,
    ),
  ],
);

// One row reserves one identified physical unit; allocating N units inserts N rows.
export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: entityId(),
    orderItemId: uuid('order_item_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: reservationStatusEnum('status').default('ACTIVE').notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'reservations_order_variant_fk',
      columns: [t.orderItemId, t.variantId],
      foreignColumns: [orderItems.id, orderItems.variantId],
    }),
    foreignKey({
      name: 'reservations_unit_variant_fk',
      columns: [t.unitId, t.variantId],
      foreignColumns: [productUnits.id, productUnits.variantId],
    }),
    unique('reservations_id_item_unit_uq').on(t.id, t.orderItemId, t.unitId),
    uniqueIndex('reservations_active_unit_uidx')
      .on(t.unitId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('reservations_order_item_idx').on(t.orderItemId, t.status),
    check(
      'reservation_end_check',
      sql`(${t.status} = 'ACTIVE' AND ${t.endedAt} IS NULL) OR (${t.status} <> 'ACTIVE' AND ${t.endedAt} IS NOT NULL AND ${t.endedAt} >= ${t.reservedAt})`,
    ),
  ],
);

export const saleCycles = pgTable(
  'sale_cycles',
  {
    id: entityId(),
    unitId: uuid('unit_id').notNull(),
    orderItemId: uuid('order_item_id').notNull(),
    reservationId: uuid('reservation_id').notNull().unique(),
    cycleNumber: integer('cycle_number').notNull(),
    purchaseCostRevisionId: uuid('purchase_cost_revision_id').references(
      () => costLayerPrices.id,
    ),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeReason: text('close_reason'),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'sale_cycles_reservation_fk',
      columns: [t.reservationId, t.orderItemId, t.unitId],
      foreignColumns: [
        inventoryReservations.id,
        inventoryReservations.orderItemId,
        inventoryReservations.unitId,
      ],
    }),
    unique('sale_cycles_unit_number_uq').on(t.unitId, t.cycleNumber),
    unique('sale_cycles_id_unit_uq').on(t.id, t.unitId),
    uniqueIndex('sale_cycles_active_unit_uidx')
      .on(t.unitId)
      .where(sql`${t.closedAt} IS NULL`),
    check('sale_cycle_number_check', sql`${t.cycleNumber} > 0`),
  ],
);
export const orderUnitAssignments = pgTable('order_unit_assignments', {
  id: entityId(),
  saleCycleId: uuid('sale_cycle_id')
    .notNull()
    .unique()
    .references(() => saleCycles.id),
  packedAt: timestamp('packed_at', { withTimezone: true }),
  avitoMarkingStatus: avitoMarkingStatusEnum('avito_marking_status')
    .default('NOT_SENT')
    .notNull(),
  providerConfirmedAt: timestamp('provider_confirmed_at', {
    withTimezone: true,
  }),
  lastOperationId: uuid('last_operation_id')
    .notNull()
    .references(() => inventoryOperations.id),
  ...timestamps(),
});

export const shipments = pgTable(
  'shipments',
  {
    id: entityId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    parcelCode: text('parcel_code').notNull().unique(),
    externalShipmentId: text('external_shipment_id'),
    status: text('status').default('DRAFT').notNull(),
    compositionRevision: integer('composition_revision').default(1).notNull(),
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
    handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    handoverSource: text('handover_source'),
    handoverEvidenceReference: text('handover_evidence_reference'),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('shipments_id_order_uq').on(t.id, t.orderId),
    index('shipments_order_idx').on(t.orderId),
    check(
      'shipment_status_check',
      sql`${t.status} IN ('DRAFT', 'PACKED', 'READY', 'HANDED_OVER', 'DELIVERED', 'CANCELLED')`,
    ),
    check('shipment_revision_check', sql`${t.compositionRevision} > 0`),
    check(
      'shipment_handover_check',
      sql`${t.status} NOT IN ('HANDED_OVER', 'DELIVERED') OR (${t.handedOverAt} IS NOT NULL AND ${t.handoverSource} IS NOT NULL)`,
    ),
    check(
      'shipment_delivery_check',
      sql`${t.deliveredAt} IS NULL OR (${t.handedOverAt} IS NOT NULL AND ${t.deliveredAt} >= ${t.handedOverAt})`,
    ),
  ],
);
export const shipmentItems = pgTable(
  'shipment_items',
  {
    id: entityId(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id),
    saleCycleId: uuid('sale_cycle_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'shipment_items_cycle_unit_fk',
      columns: [t.saleCycleId, t.unitId],
      foreignColumns: [saleCycles.id, saleCycles.unitId],
    }),
    unique('shipment_items_id_unit_uq').on(t.id, t.unitId),
    uniqueIndex('shipment_items_active_cycle_uidx')
      .on(t.saleCycleId)
      .where(sql`${t.removedAt} IS NULL`),
    index('shipment_items_shipment_idx').on(t.shipmentId),
  ],
);

export const returns = pgTable(
  'returns',
  {
    id: entityId(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    externalReturnId: text('external_return_id'),
    kind: text('kind').notNull(),
    status: text('status').default('EXPECTED').notNull(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    unique('returns_order_external_uq').on(t.orderId, t.externalReturnId),
    check(
      'return_kind_check',
      sql`${t.kind} IN ('CUSTOMER', 'UNCLAIMED', 'CANCELLED_SHIPMENT')`,
    ),
    check(
      'return_status_check',
      sql`${t.status} IN ('EXPECTED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'DISPUTED')`,
    ),
  ],
);
export const returnItems = pgTable(
  'return_items',
  {
    id: entityId(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => returns.id),
    shipmentItemId: uuid('shipment_item_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    condition: text('condition').default('UNCHECKED').notNull(),
    inspectedAt: timestamp('inspected_at', { withTimezone: true }),
    inspectionNote: text('inspection_note'),
    lastOperationId: uuid('last_operation_id')
      .notNull()
      .references(() => inventoryOperations.id),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'return_items_shipment_unit_fk',
      columns: [t.shipmentItemId, t.unitId],
      foreignColumns: [shipmentItems.id, shipmentItems.unitId],
    }),
    unique('return_items_shipment_item_uq').on(t.shipmentItemId),
    unique('return_items_id_unit_uq').on(t.id, t.unitId),
    check(
      'return_item_condition_check',
      sql`${t.condition} IN ('UNCHECKED', 'GOOD', 'DEFECTIVE', 'DAMAGED_CODE', 'WRONG_ITEM')`,
    ),
  ],
);
