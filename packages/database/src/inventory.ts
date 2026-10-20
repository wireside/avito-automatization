import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  InventoryPage,
  InventoryQuery,
  InventoryUnit,
  ReceiptCommand,
  ReceiptResult,
  InventoryVariant,
} from '@avito/domain';
import type { Database } from './client.js';
import {
  costLayers,
  inventoryMovements,
  inventoryOperations,
  inventoryScans,
  productUnits,
  productVariants,
  stockLocations,
  stockReceiptItems,
  stockReceipts,
  unitMarkings,
  variantIdentifiers,
  warehouses,
} from './schema.js';

const unitSelect = sql`SELECT u.id, u.internal_code AS "internalCode", u.variant_id AS "variantId", v.name,
 m.masked_code AS "maskedCode", u.current_state AS state, l.name AS location,
 r.id AS "receiptId", r.number AS "receiptNumber", r.received_at AS "receivedAt"
 FROM product_units u JOIN product_variants v ON v.id=u.variant_id
 JOIN cost_layers c ON c.id=u.cost_layer_id JOIN stock_receipt_items ri ON ri.id=c.receipt_item_id
 JOIN stock_receipts r ON r.id=ri.receipt_id
 JOIN unit_markings m ON m.unit_id=u.id AND m.retired_at IS NULL
 LEFT JOIN stock_locations l ON l.id=u.current_location_id`;
type UnitRow = Omit<InventoryUnit, 'receivedAt'> & { receivedAt: string };
const mapUnit = (row: UnitRow): InventoryUnit => ({
  ...row,
  receivedAt: new Date(row.receivedAt).toISOString(),
});
const one = <T>(rows: T[]): T => {
  if (!rows[0]) throw new Error('Inventory persistence invariant failed');
  return rows[0];
};

export function createInventoryStore(db: Database) {
  return {
    async receive(command: ReceiptCommand): Promise<ReceiptResult> {
      return db.transaction(async (tx) => {
        // Serialize request replay first, then catalog resolution. One GTIN may contain many units.
        const key = `receipt-scan:${command.actorUserId}:${command.requestId}`;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
        );
        const [replay] = await tx
          .select()
          .from(inventoryScans)
          .where(eq(inventoryScans.idempotencyKey, key));
        if (replay) {
          if (
            replay.inputFingerprint !== command.inputFingerprint ||
            replay.scannerProfile !== command.scannerProfile
          )
            return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
          const row = one(
            (
              await tx.execute<UnitRow>(
                sql`${unitSelect} WHERE u.id=${replay.unitId}`,
              )
            ).rows,
          );
          return {
            ok: true,
            outcome: replay.result === 'ACCEPTED' ? 'ACCEPTED' : 'DUPLICATE',
            unit: mapUnit(row),
            replayed: true,
          };
        }
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`receipt-gtin:${command.gtin}`}, 0))`,
        );
        const [known] = await tx
          .select()
          .from(unitMarkings)
          .where(eq(unitMarkings.identityHash, command.identityHash));
        const opId = randomUUID();
        const now = new Date();
        const op = {
          id: opId,
          kind: 'RECEIPT' as const,
          idempotencyKey: key,
          actorKind: 'USER',
          actorUserId: command.actorUserId,
          source: 'mini-app-intake',
          correlationId: command.requestId,
          occurredAt: now,
        };
        if (known) {
          // Existing or retired identity is never received a second time, including sold units.
          const row = one(
            (
              await tx.execute<UnitRow>(
                sql`${unitSelect} WHERE u.id=${known.unitId}`,
              )
            ).rows,
          );
          await tx.insert(inventoryOperations).values(op);
          await tx.insert(inventoryScans).values({
            operationId: opId,
            idempotencyKey: key,
            receiptId: row.receiptId,
            unitId: known.unitId,
            markingId: known.id,
            result: 'DUPLICATE',
            scannerProfile: command.scannerProfile,
            inputFingerprint: command.inputFingerprint,
          });
          return {
            ok: true,
            outcome: 'DUPLICATE',
            unit: mapUnit(row),
            replayed: false,
          };
        }
        const [destination] = await tx
          .select({ warehouseId: warehouses.id, locationId: stockLocations.id })
          .from(warehouses)
          .innerJoin(
            stockLocations,
            eq(stockLocations.warehouseId, warehouses.id),
          )
          .where(
            and(
              eq(warehouses.code, 'MAIN'),
              isNull(warehouses.archivedAt),
              eq(stockLocations.code, 'RECEIVING'),
              eq(stockLocations.kind, 'QUARANTINE'),
              isNull(stockLocations.archivedAt),
            ),
          );
        if (!destination) return { ok: false, code: 'WAREHOUSE_UNAVAILABLE' };
        const [existing] = await tx
          .select({ identifier: variantIdentifiers, variant: productVariants })
          .from(variantIdentifiers)
          .innerJoin(
            productVariants,
            eq(productVariants.id, variantIdentifiers.variantId),
          )
          .where(eq(variantIdentifiers.gtin, command.gtin));
        if (
          existing &&
          (existing.variant.archivedAt ||
            existing.variant.reviewStatus === 'ARCHIVED')
        )
          return { ok: false, code: 'CATALOG_ARCHIVED' };
        let variantId = existing?.variant.id;
        let identifierId = existing?.identifier.id;
        if (!variantId || !identifierId) {
          variantId = one(
            await tx
              .insert(productVariants)
              .values({
                sku: `GTIN:${command.gtin}`,
                name: `Товар ${command.gtin}`,
                reviewStatus: 'UNRESOLVED',
              })
              .returning(),
          ).id;
          identifierId = one(
            await tx
              .insert(variantIdentifiers)
              .values({
                variantId,
                gtin: command.gtin,
                source: 'MANUAL',
                sourceReference: `scan:${command.requestId}`,
              })
              .returning(),
          ).id;
        }
        await tx.insert(inventoryOperations).values(op);
        const receiptId = randomUUID();
        const receipt = one(
          await tx
            .insert(stockReceipts)
            .values({
              id: receiptId,
              number: `SCAN-${receiptId}`,
              warehouseId: destination.warehouseId,
              receivedAt: now,
              lastOperationId: opId,
            })
            .returning(),
        );
        const item = one(
          await tx
            .insert(stockReceiptItems)
            .values({ receiptId: receipt.id, variantId, expectedQuantity: 1 })
            .returning(),
        );
        const layer = one(
          await tx
            .insert(costLayers)
            .values({ receiptItemId: item.id, variantId })
            .returning(),
        );
        const unit = one(
          await tx
            .insert(productUnits)
            .values({
              internalCode: `U-${randomUUID()}`,
              variantId,
              costLayerId: layer.id,
              createdByOperationId: opId,
            })
            .returning(),
        );
        const marking = one(
          await tx
            .insert(unitMarkings)
            .values({
              unitId: unit.id,
              variantId,
              variantIdentifierId: identifierId,
              identityHash: command.identityHash,
              maskedCode: command.maskedCode,
              payloadCiphertext: command.payloadCiphertext,
              encryptionKeyId: command.encryptionKeyId,
              parserProfile: command.parserProfile,
              scannerProfile: command.scannerProfile,
              lastOperationId: opId,
            })
            .returning(),
        );
        const postId = randomUUID();
        await tx
          .insert(inventoryOperations)
          .values({ ...op, id: postId, idempotencyKey: `${key}:post` });
        await tx
          .update(stockReceipts)
          .set({
            status: 'POSTED',
            postedAt: now,
            lastOperationId: postId,
            updatedAt: now,
          })
          .where(eq(stockReceipts.id, receipt.id));
        await tx.insert(inventoryMovements).values({
          operationId: postId,
          unitId: unit.id,
          unitRevision: 1,
          fromState: 'NOT_RECEIVED',
          toState: 'QUARANTINE',
          toLocationId: destination.locationId,
        });
        await tx.insert(inventoryScans).values({
          operationId: postId,
          idempotencyKey: key,
          receiptId: receipt.id,
          unitId: unit.id,
          markingId: marking.id,
          result: 'ACCEPTED',
          scannerProfile: command.scannerProfile,
          inputFingerprint: command.inputFingerprint,
        });
        const row = one(
          (await tx.execute<UnitRow>(sql`${unitSelect} WHERE u.id=${unit.id}`))
            .rows,
        );
        return {
          ok: true,
          outcome: 'ACCEPTED',
          unit: mapUnit(row),
          replayed: false,
        };
      });
    },
    async list(query: InventoryQuery): Promise<InventoryPage> {
      // A consistent snapshot keeps totals, variant counts and pagination in agreement.
      return db.transaction(
        async (tx) => {
          const warehouse = one(
            await tx
              .select({ id: warehouses.id, name: warehouses.name })
              .from(warehouses)
              .where(eq(warehouses.code, 'MAIN')),
          );
          const totals = one(
            (
              await tx.execute<{
                onHand: number;
                available: number;
                quarantine: number;
              }>(
                sql`SELECT coalesce(sum(on_hand),0)::int AS "onHand", coalesce(sum(available),0)::int AS available, coalesce(sum(quarantine),0)::int AS quarantine FROM stock_balances WHERE warehouse_id=${warehouse.id}`,
              )
            ).rows,
          );
          const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
          const rows = (
            await tx.execute<
              InventoryVariant & Record<string, unknown>
            >(sql`SELECT v.id, v.product_id AS "productId", p.name AS "productName", p.manufacturer_article AS article,
      v.name, v.size_label AS size, v.color, v.review_status AS "reviewStatus",
      ARRAY(SELECT gtin FROM variant_identifiers WHERE variant_id=v.id ORDER BY gtin) AS gtins,
      sum(b.on_hand)::int AS "onHand", sum(b.available)::int AS available, sum(b.quarantine)::int AS quarantine,
      sum(b.reserved)::int AS reserved, sum(b.defective)::int AS defective
      FROM stock_balances b JOIN product_variants v ON v.id=b.variant_id LEFT JOIN products p ON p.id=v.product_id
      WHERE b.warehouse_id=${warehouse.id} AND (v.name ILIKE ${pattern} OR v.sku ILIKE ${pattern} OR p.name ILIKE ${pattern} OR p.manufacturer_article ILIKE ${pattern} OR v.size_label ILIKE ${pattern} OR v.color ILIKE ${pattern} OR EXISTS(SELECT 1 FROM variant_identifiers vi WHERE vi.variant_id=v.id AND vi.gtin ILIKE ${pattern}))
      GROUP BY v.id,p.id ORDER BY coalesce(p.name,v.name),v.size_label NULLS LAST,v.color NULLS LAST,v.id
      LIMIT ${query.limit + 1} OFFSET ${query.offset}`)
          ).rows;
          return {
            warehouse,
            totals,
            items: rows.slice(0, query.limit),
            hasMore: rows.length > query.limit,
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },
    async units(variantId: string, offset: number) {
      const rows = (
        await db.execute<UnitRow>(
          sql`${unitSelect} JOIN warehouses w ON w.id=l.warehouse_id WHERE u.variant_id=${variantId} AND w.code='MAIN' ORDER BY r.received_at DESC,u.id LIMIT 21 OFFSET ${offset}`,
        )
      ).rows;
      return {
        items: rows.slice(0, 20).map(mapUnit),
        hasMore: rows.length > 20,
      };
    },
  };
}
