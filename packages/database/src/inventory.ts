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
import { canEnrichIntakeVariant } from '@avito/domain';
import {
  costLayers,
  catalogAttributeSources,
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
 coalesce(p.manufacturer_article, v.attributes->'intakeCatalog'->>'article') AS article,
 v.color, v.size_label AS size, v.size_system AS "sizeSystem",
 m.masked_code AS "maskedCode", u.current_state AS state, l.name AS location,
 r.id AS "receiptId", r.number AS "receiptNumber", r.received_at AS "receivedAt"
 FROM product_units u JOIN product_variants v ON v.id=u.variant_id
 LEFT JOIN products p ON p.id=v.product_id
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
  type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
  const findVariant = async (
    tx: Pick<Database, 'select'>,
    gtin: string,
    lock = false,
  ) => {
    const query = tx
      .select({
        identifier: variantIdentifiers,
        variant: productVariants,
        parentArchived: sql<boolean>`EXISTS (SELECT 1 FROM products p WHERE p.id=${productVariants.productId} AND p.archived_at IS NOT NULL)`,
      })
      .from(variantIdentifiers)
      .innerJoin(
        productVariants,
        eq(productVariants.id, variantIdentifiers.variantId),
      )
      .where(eq(variantIdentifiers.gtin, gtin));
    const [existing] = await (lock ? query.for('update') : query);
    return existing;
  };
  const hasCatalogEvidence = async (
    tx: Pick<Database, 'execute'>,
    variantId: string,
    gtin: string,
  ) => {
    const result = await tx.execute<{ found: boolean }>(sql`SELECT EXISTS (
      SELECT 1 FROM catalog_attribute_sources WHERE variant_id=${variantId}
        AND source='NATIONAL_CATALOG' AND attributes->>'gtin'=${gtin}
    ) AS found`);
    return result.rows[0]?.found === true;
  };
  const enrichVariant = async (
    tx: Transaction,
    variant: typeof productVariants.$inferSelect,
    command: ReceiptCommand,
  ) => {
    const catalog = command.catalog;
    if (!catalog || catalog.gtin !== command.gtin || !catalog.name.trim())
      return;
    if (canEnrichIntakeVariant(variant, command.gtin)) {
      await tx
        .update(productVariants)
        .set({
          name: catalog.name,
          color: catalog.color,
          sizeLabel: catalog.size,
          sizeSystem: catalog.sizeSystem,
          materialComposition: catalog.materialComposition,
          attributes: {
            intakeCatalog: {
              source: 'NATIONAL_CATALOG',
              sourceReference: catalog.sourceReference,
              article: catalog.article,
              sourceName: catalog.sourceName,
              observedAt: catalog.observedAt,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(productVariants.id, variant.id));
    }
    // Preserve local/manual labels, but record NK existence for any mapped variant.
    if (!(await hasCatalogEvidence(tx, variant.id, command.gtin))) {
      await tx.insert(catalogAttributeSources).values({
        variantId: variant.id,
        source: 'NATIONAL_CATALOG',
        sourceReference: catalog.sourceReference,
        attributes: { ...catalog },
        observedAt: new Date(catalog.observedAt),
        recordedBy: command.actorUserId,
      });
    }
  };
  const completeLegacyIntake = async (
    tx: Transaction,
    unitId: string,
    command: ReceiptCommand,
  ) => {
    // Upgrade only an untouched original receipt, never a return or an explicit hold.
    const legacy = (
      await tx.execute<{
        id: string;
        locationId: string;
        targetId: string | null;
      }>(sql`
      SELECT u.id, u.current_location_id AS "locationId", target.id AS "targetId"
      FROM product_units u JOIN stock_locations l ON l.id=u.current_location_id
      JOIN warehouses w ON w.id=l.warehouse_id
      JOIN product_variants v ON v.id=u.variant_id LEFT JOIN products p ON p.id=v.product_id
      LEFT JOIN stock_locations target ON target.warehouse_id=w.id AND target.code='STOCK' AND target.kind='SELLABLE' AND target.archived_at IS NULL
      JOIN inventory_movements m ON m.unit_id=u.id AND m.unit_revision=1
      JOIN inventory_operations op ON op.id=m.operation_id
      WHERE u.id=${unitId} AND u.current_state='QUARANTINE' AND u.movement_revision=1
        AND l.code='RECEIVING' AND w.archived_at IS NULL AND v.archived_at IS NULL AND (p.id IS NULL OR p.archived_at IS NULL) AND op.kind='RECEIPT' AND op.source='mini-app-intake'
        AND EXISTS (SELECT 1 FROM catalog_attribute_sources ca WHERE ca.variant_id=u.variant_id AND ca.source='NATIONAL_CATALOG' AND ca.attributes->>'gtin'=${command.gtin})
      FOR UPDATE OF u`)
    ).rows[0];
    if (!legacy) return;
    if (!legacy.targetId) throw new Error('Intake destination unavailable');
    const id = randomUUID();
    await tx.insert(inventoryOperations).values({
      id,
      kind: 'CORRECTION',
      idempotencyKey: `intake-catalog-completion:${unitId}`,
      actorKind: 'USER',
      actorUserId: command.actorUserId,
      source: 'intake-catalog-completion',
      reason:
        'Первичная приёмка завершена по данным Национального каталога без этапа проверки',
      correlationId: command.requestId,
      occurredAt: new Date(),
    });
    await tx.insert(inventoryMovements).values({
      operationId: id,
      unitId,
      unitRevision: 2,
      fromState: 'QUARANTINE',
      toState: 'AVAILABLE',
      fromLocationId: legacy.locationId,
      toLocationId: legacy.targetId,
    });
  };
  return {
    async needsCatalogLookup(gtin: string): Promise<boolean> {
      const existing = await findVariant(db, gtin);
      return (
        !existing || !(await hasCatalogEvidence(db, existing.variant.id, gtin))
      );
    },
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
          if (command.catalog) {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtextextended(${`receipt-gtin:${command.gtin}`}, 0))`,
            );
            const existing = await findVariant(tx, command.gtin, true);
            if (existing) await enrichVariant(tx, existing.variant, command);
          }
          await completeLegacyIntake(tx, replay.unitId!, command);
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
        const existing = await findVariant(tx, command.gtin, true);
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
          if (existing) await enrichVariant(tx, existing.variant, command);
          await completeLegacyIntake(tx, known.unitId, command);
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
              eq(stockLocations.code, 'STOCK'),
              eq(stockLocations.kind, 'SELLABLE'),
              isNull(stockLocations.archivedAt),
            ),
          );
        if (!destination) return { ok: false, code: 'WAREHOUSE_UNAVAILABLE' };
        if (
          existing &&
          (existing.variant.archivedAt || existing.parentArchived)
        )
          return { ok: false, code: 'CATALOG_ARCHIVED' };
        const suppliedCatalog =
          command.catalog?.gtin === command.gtin && command.catalog.name.trim();
        if (
          !suppliedCatalog &&
          (!existing ||
            !(await hasCatalogEvidence(tx, existing.variant.id, command.gtin)))
        )
          return { ok: false, code: 'CATALOG_NOT_FOUND' };
        let variantId = existing?.variant.id;
        let identifierId = existing?.identifier.id;
        if (existing) await enrichVariant(tx, existing.variant, command);
        if (!variantId || !identifierId) {
          const createdVariant = one(
            await tx
              .insert(productVariants)
              .values({
                sku: `GTIN:${command.gtin}`,
                name: `Товар ${command.gtin}`,
              })
              .returning(),
          );
          variantId = createdVariant.id;
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
          await enrichVariant(tx, createdVariant, command);
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
          toState: 'AVAILABLE',
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
            >(sql`SELECT v.id, v.product_id AS "productId", p.name AS "productName", coalesce(p.manufacturer_article, v.attributes->'intakeCatalog'->>'article') AS article,
      v.name, v.size_label AS size, v.color,
      ARRAY(SELECT gtin FROM variant_identifiers WHERE variant_id=v.id ORDER BY gtin) AS gtins,
      sum(b.on_hand)::int AS "onHand", sum(b.available)::int AS available, sum(b.quarantine)::int AS quarantine,
      sum(b.reserved)::int AS reserved, sum(b.defective)::int AS defective
      FROM stock_balances b JOIN product_variants v ON v.id=b.variant_id LEFT JOIN products p ON p.id=v.product_id
      WHERE b.warehouse_id=${warehouse.id} AND (v.name ILIKE ${pattern} OR v.sku ILIKE ${pattern} OR p.name ILIKE ${pattern} OR coalesce(p.manufacturer_article, v.attributes->'intakeCatalog'->>'article') ILIKE ${pattern} OR v.size_label ILIKE ${pattern} OR v.color ILIKE ${pattern} OR EXISTS(SELECT 1 FROM variant_identifiers vi WHERE vi.variant_id=v.id AND vi.gtin ILIKE ${pattern}))
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
