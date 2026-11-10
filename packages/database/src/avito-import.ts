import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  requirePipeline,
  type MarketplaceOrder,
  type PipelineInput,
} from '@avito/domain';
import type { Database } from './client.js';
export async function prepareAvitoImport(
  db: Database,
  order: MarketplaceOrder,
  input: PipelineInput,
  accountId: string,
): Promise<PipelineInput> {
  requirePipeline(
    ['on_confirmation', 'ready_to_ship'].includes(order.status),
    'ORDER_NOT_AVAILABLE',
  );
  const warehouse = (
    await db.execute<{ warehouse_id: string }>(
      sql`SELECT warehouse_id FROM marking_pipeline_settings WHERE (${typeof input.warehouseId === 'string' ? input.warehouseId : null}::uuid IS NULL OR warehouse_id=${typeof input.warehouseId === 'string' ? input.warehouseId : null}::uuid) ORDER BY warehouse_id LIMIT 1`,
    )
  ).rows[0];
  requirePipeline(warehouse, 'SELLER_NOT_CONFIGURED');
  const channel = (
    await db.execute<{ id: string }>(
      sql`INSERT INTO sales_channels(provider,external_account_id,name) VALUES('AVITO',${accountId},'Авито') ON CONFLICT(provider,external_account_id) DO UPDATE SET name=excluded.name RETURNING id`,
    )
  ).rows[0]!;
  const existing = (
    await db.execute<{ shipment_id: string }>(
      sql`SELECT s.id AS shipment_id FROM orders o JOIN shipments s ON s.order_id=o.id WHERE o.channel_id=${channel.id} AND o.external_order_id=${order.id} ORDER BY s.created_at LIMIT 1`,
    )
  ).rows[0];
  if (existing) return { ...input, existingShipmentId: existing.shipment_id };
  const mappings = (input.mappings ?? []) as {
    externalItemId: string;
    variantId: string;
  }[];
  const lines = [];
  for (const line of order.items) {
    const listing = (
      await db.execute<{ id: string }>(
        sql`INSERT INTO avito_items(id,channel_id,external_item_id,external_key,title) VALUES(${randomUUID()},${channel.id},${line.avitoId},${line.avitoId},${line.title}) ON CONFLICT(channel_id,external_item_id) DO UPDATE SET title=excluded.title RETURNING id`,
      )
    ).rows[0]!;
    const explicit = mappings.find((m) => m.externalItemId === line.avitoId);
    if (explicit) {
      const existingMappings = (
        await db.execute<{ variant_id: string }>(
          sql`SELECT variant_id FROM avito_item_variants WHERE item_id=${listing.id} AND archived_at IS NULL`,
        )
      ).rows;
      requirePipeline(
        !existingMappings.length ||
          existingMappings.every((m) => m.variant_id === explicit.variantId),
        'LISTING_MAPPING_CONFLICT',
      );
      await db.execute(
        sql`INSERT INTO avito_item_variants(item_id,variant_id) VALUES(${listing.id},${explicit.variantId}) ON CONFLICT DO NOTHING`,
      );
    }
    const variants = (
      await db.execute<{ variant_id: string }>(
        sql`SELECT variant_id FROM avito_item_variants WHERE item_id=${listing.id} AND archived_at IS NULL`,
      )
    ).rows;
    requirePipeline(variants.length === 1, 'ORDER_MAPPING_REQUIRED', [
      line.avitoId,
    ]);
    requirePipeline(line.priceMinor !== null, 'SALE_PRICE_REQUIRED');
    lines.push({
      externalLineKey: line.avitoId,
      variantId: variants[0]!.variant_id,
      quantity: line.quantity,
      unitPriceKopecks: line.priceMinor,
    });
  }
  return {
    requestId: input.requestId,
    externalOrderId: order.id,
    externalAccountId: accountId,
    parcelCode:
      order.delivery.dispatchNumber ??
      order.delivery.trackingNumber ??
      order.id,
    warehouseId: warehouse.warehouse_id,
    items: lines,
    providerStatus: order.status,
    providerUpdatedAt: order.updatedAt,
    availableActions: order.availableActions.map((a) => a.name),
  };
}

/** Only local identity and order composition; the caller must query Avito outside SQL. */
export async function readAvitoShipmentReference(
  db: Database,
  id: string,
  accountId: string,
) {
  const order = (
    await db.execute<{ external_order_id: string; order_id: string }>(
      sql`SELECT o.external_order_id,o.id AS order_id FROM shipments s JOIN orders o ON o.id=s.order_id JOIN sales_channels c ON c.id=o.channel_id WHERE s.id=${id} AND c.provider='AVITO' AND c.external_account_id=${accountId}`,
    )
  ).rows[0];
  requirePipeline(order, 'ENTITY_NOT_FOUND');
  const lines = (
    await db.execute<{
      external_line_key: string;
      quantity: number;
      unit_price_kopecks: string | null;
    }>(
      sql`SELECT external_line_key,quantity,unit_price_kopecks FROM order_items WHERE order_id=${order.order_id} ORDER BY external_line_key`,
    )
  ).rows;
  return {
    externalOrderId: order.external_order_id,
    items: lines.map((i) => ({
      avitoId: i.external_line_key,
      quantity: i.quantity,
      priceMinor:
        i.unit_price_kopecks === null ? null : Number(i.unit_price_kopecks),
    })),
  };
}
