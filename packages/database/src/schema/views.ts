import { bigint, pgView, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// SQL definitions and guards are versioned in 0002_inventory_guards.sql.
export const stockBalances = pgView('stock_balances', {
  warehouseId: uuid('warehouse_id'),
  locationId: uuid('location_id'),
  variantId: uuid('variant_id'),
  onHand: bigint('on_hand', { mode: 'bigint' }),
  eligible: bigint('eligible', { mode: 'bigint' }),
  reserved: bigint('reserved', { mode: 'bigint' }),
  reservedEligible: bigint('reserved_eligible', { mode: 'bigint' }),
  blocked: bigint('blocked', { mode: 'bigint' }),
  available: bigint('available', { mode: 'bigint' }),
  packing: bigint('packing', { mode: 'bigint' }),
  quarantine: bigint('quarantine', { mode: 'bigint' }),
  defective: bigint('defective', { mode: 'bigint' }),
}).existing();
export const currentCostLayerPrices = pgView('current_cost_layer_prices', {
  costLayerId: uuid('cost_layer_id'),
  priceRevisionId: uuid('price_revision_id'),
  unitCostKopecks: bigint('unit_cost_kopecks', { mode: 'bigint' }),
  source: text('source'),
  sourceReference: text('source_reference'),
  effectiveAt: timestamp('effective_at', { withTimezone: true }),
}).existing();
export const currentMarkingStates = pgView('current_marking_states', {
  markingId: uuid('marking_id'),
  state: text('state'),
  ownershipVerified: text('ownership_verified'),
  observedAt: timestamp('observed_at', { withTimezone: true }),
}).existing();
