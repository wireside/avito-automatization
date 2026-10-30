-- Receipt is complete when its National Catalog data is available. No approval workflow.
-- Keep provider legal observations and return/defect states independent and unchanged.
CREATE OR REPLACE VIEW stock_unit_availability AS
SELECT u.id AS unit_id, u.variant_id, l.id AS location_id, l.warehouse_id,
       u.current_state, r.id AS reservation_id,
       (u.current_state IN ('AVAILABLE', 'PACKING')
        AND l.kind = 'SELLABLE' AND l.archived_at IS NULL AND w.archived_at IS NULL
        AND v.archived_at IS NULL AND (p.id IS NULL OR p.archived_at IS NULL)
        AND sr.status = 'POSTED'
        -- A later customer return retains its independent legal-release gate.
        AND (NOT EXISTS (SELECT 1 FROM inventory_movements returned
          WHERE returned.unit_id=u.id AND returned.return_item_id IS NOT NULL AND returned.to_state='QUARANTINE')
          OR (ms.state='IN_CIRCULATION' AND ms.ownership_verified='VERIFIED'))
        AND EXISTS (SELECT 1 FROM catalog_attribute_sources ca
          JOIN variant_identifiers vi ON vi.id=m.variant_identifier_id
          WHERE ca.variant_id=v.id AND ca.source='NATIONAL_CATALOG' AND ca.attributes->>'gtin'=vi.gtin)
        AND NOT EXISTS (SELECT 1 FROM chz_operations co
          WHERE co.marking_id = m.id AND co.status IN
            ('PREPARING','WAITING_SIGNATURE','SUBMITTED','PROCESSING','UNKNOWN_RESULT','MANUAL_ATTENTION'))
       ) IS TRUE AS is_eligible
FROM product_units u
JOIN stock_locations l ON l.id=u.current_location_id
JOIN warehouses w ON w.id=l.warehouse_id
JOIN product_variants v ON v.id=u.variant_id
LEFT JOIN products p ON p.id=v.product_id
JOIN cost_layers cl ON cl.id=u.cost_layer_id
JOIN stock_receipt_items ri ON ri.id=cl.receipt_item_id
JOIN stock_receipts sr ON sr.id=ri.receipt_id
LEFT JOIN unit_markings m ON m.unit_id=u.id AND m.retired_at IS NULL
LEFT JOIN current_marking_states ms ON ms.marking_id=m.id
LEFT JOIN inventory_reservations r ON r.unit_id=u.id AND r.status='ACTIVE';
--> statement-breakpoint
-- Preserve archive semantics before removing the obsolete review columns/enum.
UPDATE products SET archived_at=coalesce(archived_at,now()) WHERE review_status='ARCHIVED';
--> statement-breakpoint
UPDATE product_variants SET archived_at=coalesce(archived_at,now()) WHERE review_status='ARCHIVED';
--> statement-breakpoint
UPDATE product_variants SET attributes=jsonb_set(attributes,'{intakeCatalog}',(attributes->'intakeCatalog')-'status')
WHERE jsonb_typeof(attributes->'intakeCatalog')='object' AND (attributes->'intakeCatalog') ? 'status';
--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT "variants_verified_model_check";--> statement-breakpoint
ALTER TABLE "product_variants" DROP COLUMN "review_status";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "review_status";--> statement-breakpoint
DROP TYPE "public"."catalog_review";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_apply_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE u product_units%ROWTYPE; op inventory_operations%ROWTYPE;
  target_kind stock_location_kind; target_warehouse uuid; receipt_record stock_receipts%ROWTYPE;
  source_shipment shipments%ROWTYPE; source_return returns%ROWTYPE;
BEGIN
  SELECT * INTO STRICT u FROM product_units WHERE id = NEW.unit_id FOR UPDATE;
  SELECT * INTO STRICT op FROM inventory_operations WHERE id = NEW.operation_id;
  IF NEW.unit_revision <> u.movement_revision + 1 OR NEW.from_state <> u.current_state
      OR NEW.from_location_id IS DISTINCT FROM u.current_location_id THEN
    RAISE EXCEPTION 'Stale unit position or movement revision' USING ERRCODE = '23514';
  END IF;
  IF (NEW.to_state IN ('AVAILABLE','PACKING','QUARANTINE','DEFECTIVE')) <> (NEW.to_location_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Physical state and warehouse location disagree' USING ERRCODE = '23514';
  END IF;
  IF NEW.to_location_id IS NOT NULL THEN
    SELECT kind, warehouse_id INTO STRICT target_kind,target_warehouse FROM stock_locations
      WHERE id = NEW.to_location_id AND archived_at IS NULL;
    IF (NEW.to_state IN ('AVAILABLE','PACKING') AND target_kind <> 'SELLABLE')
        OR (NEW.to_state = 'QUARANTINE' AND target_kind <> 'QUARANTINE')
        OR (NEW.to_state = 'DEFECTIVE' AND target_kind <> 'DEFECT') THEN
      RAISE EXCEPTION 'Location kind does not match physical state' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.reverses_movement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM inventory_movements m WHERE m.id = NEW.reverses_movement_id AND m.unit_id = NEW.unit_id
      AND m.from_state = NEW.to_state AND m.to_state = NEW.from_state
      AND m.from_location_id IS NOT DISTINCT FROM NEW.to_location_id
      AND m.to_location_id IS NOT DISTINCT FROM NEW.from_location_id
  ) THEN
    RAISE EXCEPTION 'Correction must reverse a movement of the same unit' USING ERRCODE = '23514';
  END IF;
  CASE op.kind
    WHEN 'RECEIPT' THEN
      IF NEW.from_state <> 'NOT_RECEIVED' OR NEW.to_state <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'Receipt enters available stock directly' USING ERRCODE = '23514';
      END IF;
      SELECT sr.* INTO STRICT receipt_record FROM cost_layers cl
        JOIN stock_receipt_items ri ON ri.id = cl.receipt_item_id
        JOIN stock_receipts sr ON sr.id = ri.receipt_id WHERE cl.id = u.cost_layer_id;
      IF receipt_record.status <> 'POSTED' OR receipt_record.warehouse_id <> target_warehouse THEN
        RAISE EXCEPTION 'Receipt must be posted into its own warehouse' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM unit_markings m JOIN variant_identifiers vi ON vi.id=m.variant_identifier_id
        JOIN catalog_attribute_sources ca ON ca.variant_id=u.variant_id AND ca.source='NATIONAL_CATALOG' AND ca.attributes->>'gtin'=vi.gtin
        WHERE m.unit_id=u.id AND m.retired_at IS NULL) THEN
        RAISE EXCEPTION 'Receipt requires National Catalog data for its GTIN' USING ERRCODE = '23514';
      END IF;
    WHEN 'RELEASE' THEN
      IF NEW.from_state <> 'QUARANTINE' OR NEW.to_state <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'Release must move quarantine to available' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (
        SELECT 1 FROM inventory_movements prior JOIN return_items ri ON ri.id = prior.return_item_id
        WHERE prior.id = (SELECT id FROM inventory_movements WHERE unit_id = u.id AND to_state = 'QUARANTINE'
          AND from_state <> 'QUARANTINE' ORDER BY unit_revision DESC LIMIT 1)
          AND (ri.condition <> 'GOOD' OR ri.inspected_at IS NULL)
      ) THEN
        RAISE EXCEPTION 'Returned units require a good physical inspection before release' USING ERRCODE = '23514';
      END IF;
    WHEN 'PACK' THEN
      IF NEW.from_state <> 'AVAILABLE' OR NEW.to_state <> 'PACKING'
          OR NOT EXISTS (SELECT 1 FROM inventory_reservations WHERE unit_id = u.id AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Packing requires an available reserved unit' USING ERRCODE = '23514';
      END IF;
    WHEN 'UNPACK' THEN
      IF NEW.from_state <> 'PACKING' OR NEW.to_state NOT IN ('AVAILABLE','QUARANTINE') THEN
        RAISE EXCEPTION 'Invalid unpack transition' USING ERRCODE = '23514';
      END IF;
    WHEN 'SHIP' THEN
      SELECT s.* INTO STRICT source_shipment FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
        WHERE si.id = NEW.shipment_item_id AND si.unit_id = u.id AND si.removed_at IS NULL;
      IF NEW.from_state NOT IN ('AVAILABLE','PACKING') OR NEW.to_state <> 'IN_TRANSIT'
          OR source_shipment.handed_over_at IS NULL OR source_shipment.status <> 'HANDED_OVER'
          OR source_shipment.warehouse_id <> (SELECT warehouse_id FROM stock_locations WHERE id = u.current_location_id) THEN
        RAISE EXCEPTION 'Shipment requires recorded physical handover from the matching warehouse' USING ERRCODE = '23514';
      END IF;
    WHEN 'DELIVER' THEN
      IF NEW.from_state <> 'IN_TRANSIT' OR NEW.to_state <> 'WITH_CUSTOMER' THEN
        RAISE EXCEPTION 'Invalid delivery transition' USING ERRCODE = '23514';
      END IF;
    WHEN 'START_RETURN' THEN
      IF NEW.from_state NOT IN ('IN_TRANSIT','WITH_CUSTOMER') OR NEW.to_state <> 'RETURN_IN_TRANSIT' THEN
        RAISE EXCEPTION 'Invalid return logistics transition' USING ERRCODE = '23514';
      END IF;
    WHEN 'RETURN' THEN
      SELECT r.* INTO STRICT source_return FROM return_items ri JOIN returns r ON r.id = ri.return_id
        WHERE ri.id = NEW.return_item_id AND ri.unit_id = u.id;
      IF NEW.from_state NOT IN ('IN_TRANSIT','WITH_CUSTOMER','RETURN_IN_TRANSIT') OR NEW.to_state <> 'QUARANTINE'
          OR source_return.received_at IS NULL OR source_return.warehouse_id <> target_warehouse THEN
        RAISE EXCEPTION 'Return requires physical receipt in quarantine' USING ERRCODE = '23514';
      END IF;
    WHEN 'TRANSFER' THEN
      IF NEW.from_state <> NEW.to_state OR NEW.from_location_id IS NULL OR NEW.to_location_id IS NULL THEN
        RAISE EXCEPTION 'Transfer requires two warehouse locations and the same physical state' USING ERRCODE = '23514';
      END IF;
    WHEN 'DEFECT' THEN
      IF NEW.from_location_id IS NULL OR NEW.to_state <> 'DEFECTIVE' THEN
        RAISE EXCEPTION 'Defect requires a physically present unit' USING ERRCODE = '23514';
      END IF;
    WHEN 'LOSS' THEN
      IF NEW.from_state IN ('NOT_RECEIVED','LOST','DISPOSED','WITH_SUPPLIER') OR NEW.to_state <> 'LOST' THEN
        RAISE EXCEPTION 'Invalid loss transition' USING ERRCODE = '23514';
      END IF;
    WHEN 'DISPOSE' THEN
      IF NEW.from_location_id IS NULL OR NEW.to_state <> 'DISPOSED' THEN
        RAISE EXCEPTION 'Disposal requires a physically present unit' USING ERRCODE = '23514';
      END IF;
    WHEN 'SUPPLIER_RETURN' THEN
      IF NEW.from_location_id IS NULL OR NEW.to_state <> 'WITH_SUPPLIER' THEN
        RAISE EXCEPTION 'Supplier return requires a physically present unit' USING ERRCODE = '23514';
      END IF;
    WHEN 'CORRECTION' THEN
      IF op.reason IS NULL OR NEW.from_state = 'NOT_RECEIVED' OR NEW.to_state = 'NOT_RECEIVED' THEN
        RAISE EXCEPTION 'Corrections require a reason and cannot erase/create a receipt' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Operation kind does not permit physical movements' USING ERRCODE = '23514';
  END CASE;
  UPDATE product_units SET current_state = NEW.to_state, current_location_id = NEW.to_location_id,
    movement_revision = NEW.unit_revision, updated_at = now() WHERE id = u.id;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- A new sellable location avoids reclassifying historical quarantine locations.
INSERT INTO stock_locations(warehouse_id,code,name,kind)
SELECT id,'STOCK','Основное хранение','SELLABLE' FROM warehouses WHERE code='MAIN'
ON CONFLICT(warehouse_id,code) DO NOTHING;
--> statement-breakpoint
-- Move only untouched original catalog-backed receipts, not returns, defects or explicit holds.
-- Existing movements, raw catalog evidence and legal CHZ events remain immutable.
DO $$
DECLARE item record; op_id uuid;
BEGIN
  FOR item IN
    SELECT u.id,u.current_location_id, target.id AS target_id
    FROM product_units u JOIN stock_locations l ON l.id=u.current_location_id
    JOIN warehouses w ON w.id=l.warehouse_id
    JOIN stock_locations target ON target.warehouse_id=w.id AND target.code='STOCK' AND target.kind='SELLABLE' AND target.archived_at IS NULL
    JOIN inventory_movements movement ON movement.unit_id=u.id AND movement.unit_revision=1
    JOIN inventory_operations original_op ON original_op.id=movement.operation_id
    JOIN product_variants v ON v.id=u.variant_id
    LEFT JOIN products p ON p.id=v.product_id
    WHERE u.current_state='QUARANTINE' AND u.movement_revision=1 AND l.code='RECEIVING'
      AND original_op.kind='RECEIPT' AND original_op.source='mini-app-intake'
      AND w.archived_at IS NULL AND v.archived_at IS NULL AND (p.id IS NULL OR p.archived_at IS NULL)
      AND EXISTS (SELECT 1 FROM unit_markings m JOIN variant_identifiers vi ON vi.id=m.variant_identifier_id
        JOIN catalog_attribute_sources ca ON ca.variant_id=u.variant_id AND ca.source='NATIONAL_CATALOG' AND ca.attributes->>'gtin'=vi.gtin
        WHERE m.unit_id=u.id AND m.retired_at IS NULL)
    ORDER BY u.id FOR UPDATE OF u
  LOOP
    op_id=gen_random_uuid();
    INSERT INTO inventory_operations(id,kind,idempotency_key,actor_kind,source,reason,correlation_id,occurred_at)
    VALUES(op_id,'CORRECTION','migration:intake-without-review:'||item.id,'SYSTEM','intake-without-review-migration',
      'Первичная приёмка завершена по данным Национального каталога без этапа проверки',gen_random_uuid(),now());
    INSERT INTO inventory_movements(operation_id,unit_id,unit_revision,from_state,to_state,from_location_id,to_location_id)
    VALUES(op_id,item.id,2,'QUARANTINE','AVAILABLE',item.current_location_id,item.target_id);
  END LOOP;
END $$;
