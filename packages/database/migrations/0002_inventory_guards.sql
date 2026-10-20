-- Read models are derived, never writable balances. These definitions are kept
-- in a custom versioned migration because Drizzle does not model trigger bodies.
CREATE VIEW current_marking_states AS
SELECT DISTINCT ON (marking_id) marking_id, state::text AS state,
       ownership_verified, observed_at
FROM unit_marking_events
ORDER BY marking_id, observed_at DESC, id DESC;
--> statement-breakpoint
CREATE VIEW current_cost_layer_prices AS
SELECT DISTINCT ON (cost_layer_id) cost_layer_id, id AS price_revision_id,
       unit_cost_kopecks, source::text AS source, source_reference, effective_at
FROM cost_layer_prices
ORDER BY cost_layer_id, revision DESC;
--> statement-breakpoint
CREATE VIEW stock_unit_availability AS
SELECT u.id AS unit_id, u.variant_id, l.id AS location_id, l.warehouse_id,
       u.current_state, r.id AS reservation_id,
       (u.current_state IN ('AVAILABLE', 'PACKING')
        AND l.kind = 'SELLABLE' AND l.archived_at IS NULL AND w.archived_at IS NULL
        AND v.review_status = 'VERIFIED' AND v.archived_at IS NULL
        AND p.review_status = 'VERIFIED' AND p.archived_at IS NULL
        AND ms.state = 'IN_CIRCULATION' AND ms.ownership_verified = 'VERIFIED'
        AND sr.status = 'POSTED' AND sd.verification_status = 'VERIFIED'
        AND NOT EXISTS (SELECT 1 FROM chz_operations co
          WHERE co.marking_id = m.id AND co.status IN
            ('PREPARING','WAITING_SIGNATURE','SUBMITTED','PROCESSING','UNKNOWN_RESULT','MANUAL_ATTENTION'))
       ) IS TRUE AS is_eligible
FROM product_units u
JOIN stock_locations l ON l.id = u.current_location_id
JOIN warehouses w ON w.id = l.warehouse_id
JOIN product_variants v ON v.id = u.variant_id
LEFT JOIN products p ON p.id = v.product_id
JOIN cost_layers cl ON cl.id = u.cost_layer_id
JOIN stock_receipt_items ri ON ri.id = cl.receipt_item_id
JOIN stock_receipts sr ON sr.id = ri.receipt_id
LEFT JOIN supply_documents sd ON sd.id = sr.supply_document_id
LEFT JOIN unit_markings m ON m.unit_id = u.id AND m.retired_at IS NULL
LEFT JOIN current_marking_states ms ON ms.marking_id = m.id
LEFT JOIN inventory_reservations r ON r.unit_id = u.id AND r.status = 'ACTIVE';
--> statement-breakpoint
CREATE VIEW stock_balances AS
SELECT warehouse_id, location_id, variant_id,
       count(*) AS on_hand,
       count(*) FILTER (WHERE is_eligible) AS eligible,
       count(*) FILTER (WHERE reservation_id IS NOT NULL) AS reserved,
       count(*) FILTER (WHERE reservation_id IS NOT NULL AND is_eligible) AS reserved_eligible,
       count(*) FILTER (WHERE NOT is_eligible) AS blocked,
       count(*) FILTER (WHERE is_eligible AND reservation_id IS NULL) AS available,
       count(*) FILTER (WHERE current_state = 'PACKING') AS packing,
       count(*) FILTER (WHERE current_state = 'QUARANTINE') AS quarantine,
       count(*) FILTER (WHERE current_state = 'DEFECTIVE') AS defective
FROM stock_unit_availability
GROUP BY warehouse_id, location_id, variant_id;
--> statement-breakpoint
CREATE FUNCTION inventory_reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'History is append-only; create a correcting operation' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['inventory_operations','inventory_movements','inventory_events',
      'cost_layer_prices','unit_marking_events','catalog_attribute_sources','inventory_scans','audit_log'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_mutation()', target || '_immutable', target);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION inventory_safe_workflow_data(data jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(key,value), '{}'::jsonb) FROM jsonb_each(data)
  WHERE key = ANY(ARRAY['status','verification_status','avito_marking_status','condition',
    'unit_id','order_id','order_item_id','shipment_id','sale_cycle_id','return_id',
    'quantity','unit_price_kopecks','variant_id','warehouse_id','ended_at','reserved_at','closed_at','close_reason',
    'purchase_cost_revision_id','prepared_at','handed_over_at','delivered_at','received_at',
    'handover_source','composition_revision','removed_at','inspected_at','counted_at',
    'expected','expected_state','expected_movement_revision','expected_location_id',
    'counted_location_id','counted_by','retired_at','supersedes_marking_id',
    'submission_mode','effective_at','submission_due_at','confirmed_at',
    'external_document_id','provider_status','error_code']);
$$;
--> statement-breakpoint
CREATE FUNCTION inventory_capture_workflow() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE old_data jsonb; new_data jsonb; op_id uuid; old_op uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Archive or compensate workflow records instead of deleting them' USING ERRCODE = '23514';
  END IF;
  new_data := to_jsonb(NEW);
  op_id := (new_data->>'last_operation_id')::uuid;
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    old_op := (old_data->>'last_operation_id')::uuid;
    IF op_id = old_op THEN
      RAISE EXCEPTION 'Workflow update requires a new inventory operation' USING ERRCODE = '23514';
    END IF;
  END IF;
  INSERT INTO inventory_events(operation_id, entity_type, entity_id, action, previous_status, next_status, details)
  VALUES (op_id, TG_TABLE_NAME, (new_data->>'id')::uuid, TG_OP,
    coalesce(old_data->>'status', old_data->>'verification_status', old_data->>'avito_marking_status', old_data->>'condition'),
    coalesce(new_data->>'status', new_data->>'verification_status', new_data->>'avito_marking_status', new_data->>'condition'),
    jsonb_build_object('before', inventory_safe_workflow_data(old_data),
      'after', inventory_safe_workflow_data(new_data)));
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['supply_documents','stock_receipts','inventory_counts','inventory_count_items',
      'orders','order_items','inventory_reservations','sale_cycles','order_unit_assignments',
      'shipments','shipment_items','returns','return_items','unit_markings',
      'chz_operations','chz_documents','chz_document_items'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION inventory_capture_workflow()', target || '_history', target);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION inventory_guard_unit_projection() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_state <> 'NOT_RECEIVED' OR NEW.current_location_id IS NOT NULL OR NEW.movement_revision <> 0 THEN
      RAISE EXCEPTION 'New units start unreceived; add a receipt movement' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Units retain their identity for the complete lifecycle' USING ERRCODE = '23514';
  ELSE
    IF NEW.variant_id <> OLD.variant_id OR NEW.cost_layer_id <> OLD.cost_layer_id OR NEW.internal_code <> OLD.internal_code OR NEW.created_by_operation_id <> OLD.created_by_operation_id THEN
      RAISE EXCEPTION 'Unit identity and original cost layer are immutable' USING ERRCODE = '23514';
    END IF;
    IF (NEW.current_state,NEW.current_location_id,NEW.movement_revision) IS DISTINCT FROM
       (OLD.current_state,OLD.current_location_id,OLD.movement_revision) AND pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'Unit position may only change through inventory_movements' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER product_units_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON product_units
FOR EACH ROW EXECUTE FUNCTION inventory_guard_unit_projection();
--> statement-breakpoint
CREATE FUNCTION inventory_apply_movement() RETURNS trigger
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
      IF NEW.from_state <> 'NOT_RECEIVED' OR NEW.to_state <> 'QUARANTINE' THEN
        RAISE EXCEPTION 'Receipt first enters quarantine' USING ERRCODE = '23514';
      END IF;
      SELECT sr.* INTO STRICT receipt_record FROM cost_layers cl
        JOIN stock_receipt_items ri ON ri.id = cl.receipt_item_id
        JOIN stock_receipts sr ON sr.id = ri.receipt_id WHERE cl.id = u.cost_layer_id;
      IF receipt_record.status <> 'POSTED' OR receipt_record.warehouse_id <> target_warehouse THEN
        RAISE EXCEPTION 'Receipt must be posted into its own warehouse' USING ERRCODE = '23514';
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
CREATE TRIGGER inventory_movements_apply AFTER INSERT ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION inventory_apply_movement();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE unit_record product_units%ROWTYPE; item_record order_items%ROWTYPE; eligible boolean;
  order_status warehouse_order_status; requested_warehouse uuid; allocated integer;
BEGIN
  -- All reserve/move actions lock the unit. Applications lock multiple units by sorted UUID.
  SELECT * INTO STRICT unit_record FROM product_units WHERE id = NEW.unit_id FOR UPDATE;
  SELECT * INTO STRICT item_record FROM order_items WHERE id = NEW.order_item_id FOR UPDATE;
  SELECT status INTO STRICT order_status FROM orders WHERE id = item_record.order_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.unit_id,NEW.order_item_id,NEW.variant_id,NEW.warehouse_id,NEW.reserved_at) IS DISTINCT FROM
        (OLD.unit_id,OLD.order_item_id,OLD.variant_id,OLD.warehouse_id,OLD.reserved_at)
        OR OLD.status <> 'ACTIVE' OR NEW.status = 'ACTIVE' THEN
      RAISE EXCEPTION 'Reservations can only be released or consumed; reallocation creates a new row' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.status <> 'ACTIVE' OR order_status IN ('CANCELLED','DELIVERED','RETURNED') THEN
      RAISE EXCEPTION 'Cannot reserve for a closed order' USING ERRCODE = '23514';
    END IF;
    SELECT is_eligible,warehouse_id INTO eligible,requested_warehouse FROM stock_unit_availability WHERE unit_id = NEW.unit_id;
    IF eligible IS DISTINCT FROM TRUE OR unit_record.current_state <> 'AVAILABLE' OR requested_warehouse <> NEW.warehouse_id THEN
      RAISE EXCEPTION 'Unit is not eligible in the requested warehouse' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO allocated FROM inventory_reservations WHERE order_item_id = NEW.order_item_id AND status IN ('ACTIVE','CONSUMED');
    IF allocated >= item_record.quantity THEN
      RAISE EXCEPTION 'Order item already fully allocated' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER inventory_reservations_guard BEFORE INSERT OR UPDATE ON inventory_reservations
FOR EACH ROW EXECUTE FUNCTION inventory_guard_reservation();
--> statement-breakpoint
CREATE FUNCTION inventory_check_unit_commit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_unit uuid; u product_units%ROWTYPE; reservation_record inventory_reservations%ROWTYPE;
BEGIN
  target_unit := NEW.unit_id;
  SELECT * INTO STRICT u FROM product_units WHERE id = target_unit;
  SELECT * INTO reservation_record FROM inventory_reservations WHERE unit_id = target_unit AND status = 'ACTIVE';
  IF FOUND AND u.current_location_id IS NULL THEN
    RAISE EXCEPTION 'Offsite unit cannot retain an active warehouse reservation' USING ERRCODE = '23514';
  END IF;
  IF FOUND AND reservation_record.warehouse_id <> (SELECT warehouse_id FROM stock_locations WHERE id = u.current_location_id) THEN
    RAISE EXCEPTION 'Reserved unit cannot leave the allocated warehouse' USING ERRCODE = '23514';
  END IF;
  IF u.current_state = 'PACKING' AND reservation_record.id IS NULL THEN
    RAISE EXCEPTION 'Packing must retain its reservation' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'inventory_reservations' THEN
    IF NEW.status = 'CONSUMED' AND NOT EXISTS (
      SELECT 1 FROM sale_cycles sc JOIN shipment_items si ON si.sale_cycle_id = sc.id
        JOIN inventory_movements m ON m.shipment_item_id = si.id
        JOIN inventory_operations op ON op.id = m.operation_id
        WHERE sc.reservation_id = NEW.id AND op.kind = 'SHIP'
    ) THEN
      RAISE EXCEPTION 'Consuming a reservation requires its shipment movement in the same transaction' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER movements_unit_commit AFTER INSERT ON inventory_movements DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION inventory_check_unit_commit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER reservations_unit_commit AFTER INSERT OR UPDATE ON inventory_reservations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION inventory_check_unit_commit();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_workflow_links() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE related_order uuid; expected_order uuid; expected_layer uuid; expected_mode chz_submission_mode;
  expected_action chz_action; unit_record product_units%ROWTYPE; layer_record cost_layers%ROWTYPE;
  previous_count integer; parent_status text; frozen_at timestamptz;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'sale_cycles' THEN
      SELECT * INTO STRICT unit_record FROM product_units WHERE id = NEW.unit_id FOR UPDATE;
      IF NEW.purchase_cost_revision_id IS NOT NULL THEN
        SELECT cost_layer_id INTO STRICT expected_layer FROM cost_layer_prices WHERE id = NEW.purchase_cost_revision_id;
        IF expected_layer <> unit_record.cost_layer_id THEN
          RAISE EXCEPTION 'Sale cost must belong to this unit cost layer' USING ERRCODE = '23514';
        END IF;
      END IF;
      IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM inventory_reservations WHERE id = NEW.reservation_id AND status = 'ACTIVE') THEN
          RAISE EXCEPTION 'New sale cycle requires an active reservation' USING ERRCODE = '23514';
        END IF;
        SELECT coalesce(max(cycle_number),0) INTO previous_count FROM sale_cycles WHERE unit_id = NEW.unit_id;
        IF NEW.cycle_number <> previous_count + 1 THEN
          RAISE EXCEPTION 'Sale cycle sequence must be consecutive' USING ERRCODE = '23514';
        END IF;
      ELSIF (NEW.unit_id,NEW.order_item_id,NEW.reservation_id,NEW.cycle_number) IS DISTINCT FROM
          (OLD.unit_id,OLD.order_item_id,OLD.reservation_id,OLD.cycle_number) THEN
        RAISE EXCEPTION 'Sale cycle identity cannot change' USING ERRCODE = '23514';
      END IF;
    WHEN 'shipment_items' THEN
      SELECT s.order_id,s.status,s.prepared_at INTO STRICT expected_order,parent_status,frozen_at FROM shipments s WHERE s.id = NEW.shipment_id FOR UPDATE;
      SELECT oi.order_id INTO STRICT related_order FROM sale_cycles sc JOIN order_items oi ON oi.id = sc.order_item_id WHERE sc.id = NEW.sale_cycle_id;
      IF related_order <> expected_order OR parent_status <> 'DRAFT' OR frozen_at IS NOT NULL THEN
        RAISE EXCEPTION 'Shipment composition must match its order and is editable only as draft' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.shipment_id,NEW.sale_cycle_id,NEW.unit_id) IS DISTINCT FROM (OLD.shipment_id,OLD.sale_cycle_id,OLD.unit_id) THEN
        RAISE EXCEPTION 'Remove the old shipment item and create a new one' USING ERRCODE = '23514';
      END IF;
    WHEN 'order_items' THEN
      IF TG_OP = 'UPDATE' AND (NEW.order_id,NEW.channel_id,NEW.external_line_key) IS DISTINCT FROM
          (OLD.order_id,OLD.channel_id,OLD.external_line_key) THEN
        RAISE EXCEPTION 'Order line identity is immutable' USING ERRCODE = '23514';
      END IF;
      SELECT count(*) INTO previous_count FROM inventory_reservations WHERE order_item_id = NEW.id AND status IN ('ACTIVE','CONSUMED');
      IF previous_count > NEW.quantity THEN
        RAISE EXCEPTION 'Order quantity cannot be reduced below allocated units' USING ERRCODE = '23514';
      END IF;
    WHEN 'return_items' THEN
      SELECT r.order_id INTO STRICT expected_order FROM returns r WHERE r.id = NEW.return_id;
      SELECT s.order_id INTO STRICT related_order FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id WHERE si.id = NEW.shipment_item_id;
      IF related_order <> expected_order THEN
        RAISE EXCEPTION 'Return must reference its original order' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.return_id,NEW.shipment_item_id,NEW.unit_id) IS DISTINCT FROM (OLD.return_id,OLD.shipment_item_id,OLD.unit_id) THEN
        RAISE EXCEPTION 'Return lineage is immutable' USING ERRCODE = '23514';
      END IF;
    WHEN 'chz_operations' THEN
      PERFORM 1 FROM product_units WHERE id = (SELECT unit_id FROM unit_markings WHERE id = NEW.marking_id) FOR UPDATE;
      PERFORM 1 FROM unit_markings WHERE id = NEW.marking_id FOR UPDATE;
      IF NEW.sale_cycle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sale_cycles sc JOIN unit_markings m ON m.unit_id = sc.unit_id WHERE sc.id = NEW.sale_cycle_id AND m.id = NEW.marking_id) THEN
        RAISE EXCEPTION 'Marking operation must reference the same unit sale cycle' USING ERRCODE = '23514';
      END IF;
      IF NEW.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shipment_items WHERE shipment_id = NEW.shipment_id AND sale_cycle_id = NEW.sale_cycle_id AND removed_at IS NULL) THEN
        RAISE EXCEPTION 'Marking operation shipment mismatch' USING ERRCODE = '23514';
      END IF;
      IF NEW.return_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM return_items ri JOIN shipment_items si ON si.id = ri.shipment_item_id WHERE ri.return_id = NEW.return_id AND si.sale_cycle_id = NEW.sale_cycle_id) THEN
        RAISE EXCEPTION 'Marking operation return mismatch' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.marking_id,NEW.action,NEW.reason,NEW.sale_cycle_id,NEW.submission_mode,NEW.idempotency_key) IS DISTINCT FROM
          (OLD.marking_id,OLD.action,OLD.reason,OLD.sale_cycle_id,OLD.submission_mode,OLD.idempotency_key) THEN
        RAISE EXCEPTION 'Legal operation identity and submission channel are immutable' USING ERRCODE = '23514';
      END IF;
    WHEN 'chz_document_items' THEN
      SELECT submission_mode,action INTO STRICT expected_mode,expected_action FROM chz_documents WHERE id = NEW.document_id;
      IF NOT EXISTS (SELECT 1 FROM chz_operations WHERE id = NEW.chz_operation_id AND submission_mode = expected_mode AND action = expected_action) THEN
        RAISE EXCEPTION 'CHZ document and operation must share channel and action' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.document_id,NEW.chz_operation_id) IS DISTINCT FROM (OLD.document_id,OLD.chz_operation_id) THEN
        RAISE EXCEPTION 'Document item lineage is immutable' USING ERRCODE = '23514';
      END IF;
    WHEN 'inventory_scans' THEN
      IF NEW.marking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unit_markings WHERE id = NEW.marking_id AND unit_id = NEW.unit_id) THEN
        RAISE EXCEPTION 'Recognized scan marking must belong to the recorded unit' USING ERRCODE = '23514';
      END IF;
    WHEN 'unit_marking_events' THEN
      PERFORM 1 FROM product_units WHERE id = (SELECT unit_id FROM unit_markings WHERE id = NEW.marking_id) FOR UPDATE;
      IF NEW.chz_document_item_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM chz_document_items di JOIN chz_operations co ON co.id = di.chz_operation_id
        WHERE di.id = NEW.chz_document_item_id AND co.marking_id = NEW.marking_id
      ) THEN
        RAISE EXCEPTION 'Legal-state observation must match its document marking' USING ERRCODE = '23514';
      END IF;
    WHEN 'unit_markings' THEN
      PERFORM 1 FROM product_units WHERE id = NEW.unit_id FOR UPDATE;
      IF NEW.supersedes_marking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unit_markings WHERE id = NEW.supersedes_marking_id AND unit_id = NEW.unit_id AND retired_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Replacement must follow a retired marking of the same unit' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF (NEW.unit_id,NEW.variant_id,NEW.variant_identifier_id,NEW.identity_hash,NEW.supersedes_marking_id) IS DISTINCT FROM
            (OLD.unit_id,OLD.variant_id,OLD.variant_identifier_id,OLD.identity_hash,OLD.supersedes_marking_id)
            OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at) THEN
          RAISE EXCEPTION 'Marking identity is immutable; re-marking creates a linked new marking' USING ERRCODE = '23514';
        END IF;
      END IF;
    WHEN 'cost_layer_prices' THEN
      SELECT * INTO STRICT layer_record FROM cost_layers WHERE id = NEW.cost_layer_id FOR UPDATE;
      SELECT coalesce(max(revision),0) INTO previous_count FROM cost_layer_prices WHERE cost_layer_id = NEW.cost_layer_id;
      IF NEW.revision <> previous_count + 1 THEN
        RAISE EXCEPTION 'Purchase cost revisions must be consecutive' USING ERRCODE = '23514';
      END IF;
      IF NEW.source = 'MANUAL' AND NOT EXISTS (SELECT 1 FROM inventory_operations WHERE id = NEW.operation_id AND reason IS NOT NULL AND length(btrim(reason)) > 0) THEN
        RAISE EXCEPTION 'Manual purchase-cost changes require a reason' USING ERRCODE = '23514';
      END IF;
      IF NEW.supply_document_item_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM stock_receipt_items ri
        JOIN supply_document_items original_line ON original_line.id = ri.supply_document_item_id
        JOIN supply_documents original_doc ON original_doc.id = original_line.document_id
        JOIN supply_document_items di ON di.id = NEW.supply_document_item_id
        JOIN supply_documents revised_doc ON revised_doc.id = di.document_id
        WHERE ri.id = layer_record.receipt_item_id
          AND di.line_key = original_line.line_key
          AND revised_doc.supplier_id = original_doc.supplier_id
          AND revised_doc.source = original_doc.source AND revised_doc.source_reference = original_doc.source_reference
          AND (di.variant_id IS NULL OR di.variant_id = layer_record.variant_id)
          AND di.unit_cost_kopecks = NEW.unit_cost_kopecks AND di.tax_treatment = NEW.tax_treatment
      ) THEN
        RAISE EXCEPTION 'Selected purchase price must match its incoming document line' USING ERRCODE = '23514';
      END IF;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION inventory_guard_receipt_documents() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent stock_receipts%ROWTYPE; document_line supply_document_items%ROWTYPE;

BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Retain receipt and source-document history; use archive or correction' USING ERRCODE = '23514';
  END IF;
  CASE TG_TABLE_NAME
    WHEN 'supply_documents' THEN
      IF TG_OP = 'UPDATE' AND (NEW.supplier_id,NEW.source,NEW.source_reference,NEW.revision) IS DISTINCT FROM
          (OLD.supplier_id,OLD.source,OLD.source_reference,OLD.revision) THEN
        RAISE EXCEPTION 'Incoming document identity is immutable; import a new revision' USING ERRCODE = '23514';
      END IF;
    WHEN 'supply_document_items' THEN
      IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Imported document lines are immutable; import a new document revision' USING ERRCODE = '23514';
      END IF;
    WHEN 'stock_receipts' THEN
      IF NEW.supply_document_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM supply_documents WHERE id = NEW.supply_document_id AND supplier_id = NEW.supplier_id
      ) THEN
        RAISE EXCEPTION 'Receipt and incoming document must share supplier' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' THEN
        IF (NEW.warehouse_id,NEW.supplier_id,NEW.supply_document_id,NEW.received_at,NEW.posted_at) IS DISTINCT FROM
            (OLD.warehouse_id,OLD.supplier_id,OLD.supply_document_id,OLD.received_at,OLD.posted_at)
            OR NEW.status NOT IN ('POSTED','REVERSED') THEN
          RAISE EXCEPTION 'Posted receipt facts cannot be edited' USING ERRCODE = '23514';
        END IF;
      END IF;
    WHEN 'stock_receipt_items' THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Receipt lines retain their identity; cancel the draft document' USING ERRCODE = '23514';
      END IF;
      SELECT * INTO STRICT parent FROM stock_receipts WHERE id = NEW.receipt_id FOR UPDATE;
      IF parent.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Posted receipt lines cannot be edited' USING ERRCODE = '23514';
      END IF;
      IF NEW.supply_document_item_id IS NOT NULL THEN
        SELECT * INTO STRICT document_line FROM supply_document_items WHERE id = NEW.supply_document_item_id;
        IF document_line.document_id IS DISTINCT FROM parent.supply_document_id
            OR (document_line.variant_id IS NOT NULL AND document_line.variant_id <> NEW.variant_id) THEN
          RAISE EXCEPTION 'Receipt line must match its incoming document and variant' USING ERRCODE = '23514';
        END IF;
      END IF;
    WHEN 'cost_layers' THEN
      IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Original cost-layer identity is immutable' USING ERRCODE = '23514';
      END IF;
    WHEN 'stock_locations' THEN
      IF TG_OP = 'UPDATE' AND (NEW.warehouse_id,NEW.kind) IS DISTINCT FROM (OLD.warehouse_id,OLD.kind) THEN
        RAISE EXCEPTION 'Use a new location and movement instead of reclassifying a location' USING ERRCODE = '23514';
      END IF;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['supply_documents','supply_document_items','stock_receipts','stock_receipt_items','cost_layers','stock_locations'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION inventory_guard_receipt_documents()',target || '_document_guard',target);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION inventory_check_receipt_commit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_receipt_id uuid; mismatch boolean; receipt_status stock_receipt_status;
BEGIN
  IF TG_TABLE_NAME = 'stock_receipts' THEN
    target_receipt_id := NEW.id;
  ELSE
    SELECT ri.receipt_id INTO STRICT target_receipt_id FROM cost_layers cl
      JOIN stock_receipt_items ri ON ri.id = cl.receipt_item_id
      JOIN product_units u ON u.cost_layer_id = cl.id WHERE u.id = NEW.unit_id;
  END IF;
  SELECT status INTO receipt_status FROM stock_receipts WHERE id = target_receipt_id;
  IF receipt_status = 'POSTED' THEN
    SELECT EXISTS (
      SELECT 1 FROM stock_receipt_items ri LEFT JOIN cost_layers cl ON cl.receipt_item_id = ri.id
      LEFT JOIN product_units u ON u.cost_layer_id = cl.id
      LEFT JOIN inventory_movements m ON m.unit_id = u.id AND m.unit_revision = 1
      WHERE ri.receipt_id = target_receipt_id GROUP BY ri.id,ri.expected_quantity
      HAVING count(m.id) <> ri.expected_quantity
    ) INTO mismatch;
    IF mismatch OR NOT EXISTS (SELECT 1 FROM stock_receipt_items WHERE stock_receipt_items.receipt_id = target_receipt_id) THEN
      RAISE EXCEPTION 'Posted receipt must have exactly its declared per-unit inbound movements' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stock_receipts_posted_commit AFTER INSERT OR UPDATE ON stock_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_check_receipt_commit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER movements_receipt_commit AFTER INSERT ON inventory_movements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_check_receipt_commit();
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['sale_cycles','shipment_items','return_items','chz_operations',
      'chz_document_items','unit_markings','cost_layer_prices','unit_marking_events','inventory_scans','order_items'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION inventory_guard_workflow_links()',target || '_links_guard', target);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION inventory_guard_shipment_header() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.order_id,NEW.warehouse_id,NEW.parcel_code) IS DISTINCT FROM (OLD.order_id,OLD.warehouse_id,OLD.parcel_code)
      OR (OLD.prepared_at IS NOT NULL AND NEW.prepared_at IS DISTINCT FROM OLD.prepared_at)
      OR (OLD.handed_over_at IS NOT NULL AND (NEW.handed_over_at,NEW.handover_source,NEW.handover_evidence_reference) IS DISTINCT FROM (OLD.handed_over_at,OLD.handover_source,OLD.handover_evidence_reference))
      OR (OLD.status IN ('HANDED_OVER','DELIVERED') AND NEW.status NOT IN ('HANDED_OVER','DELIVERED')) THEN
    RAISE EXCEPTION 'Shipment identity, frozen composition and physical handover cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER shipments_identity_guard BEFORE UPDATE ON shipments
FOR EACH ROW EXECUTE FUNCTION inventory_guard_shipment_header();
--> statement-breakpoint
CREATE FUNCTION inventory_check_shipment_commit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_shipment uuid; shipment_record shipments%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'shipments' THEN target_shipment := NEW.id;
  ELSE target_shipment := NEW.shipment_id;
  END IF;
  SELECT * INTO STRICT shipment_record FROM shipments WHERE id = target_shipment;
  IF shipment_record.status NOT IN ('DRAFT','CANCELLED') AND NOT EXISTS (
    SELECT 1 FROM shipment_items WHERE shipment_id = target_shipment AND removed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Prepared shipment must contain units' USING ERRCODE = '23514';
  END IF;
  IF shipment_record.status IN ('HANDED_OVER','DELIVERED') AND EXISTS (
    SELECT 1 FROM shipment_items si JOIN sale_cycles sc ON sc.id = si.sale_cycle_id
    JOIN inventory_reservations r ON r.id = sc.reservation_id
    WHERE si.shipment_id = target_shipment AND si.removed_at IS NULL
      AND (r.status <> 'CONSUMED' OR NOT EXISTS (
        SELECT 1 FROM inventory_movements m JOIN inventory_operations op ON op.id = m.operation_id
        WHERE m.shipment_item_id = si.id AND op.kind = 'SHIP'))
  ) THEN
    RAISE EXCEPTION 'Handover requires shipment movements and consumed reservations for all units' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER shipments_handover_commit AFTER INSERT OR UPDATE ON shipments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_check_shipment_commit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER shipment_items_handover_commit AFTER INSERT OR UPDATE ON shipment_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_check_shipment_commit();
--> statement-breakpoint
CREATE FUNCTION inventory_guard_photo_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'photo_group_items' THEN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Photo composition changes require a new group revision' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM photo_groups WHERE id = NEW.group_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM product_photo_bindings WHERE group_id = NEW.group_id)
       OR EXISTS (SELECT 1 FROM avito_items WHERE photo_group_id = NEW.group_id) THEN
      RAISE EXCEPTION 'Bound photo revisions are frozen; create and assign a new revision' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND (NEW.group_key,NEW.revision,NEW.name) IS DISTINCT FROM (OLD.group_key,OLD.revision,OLD.name) THEN
    RAISE EXCEPTION 'Photo revision identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER photo_group_items_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON photo_group_items
FOR EACH ROW EXECUTE FUNCTION inventory_guard_photo_revision();
--> statement-breakpoint
CREATE TRIGGER photo_groups_revision_guard BEFORE UPDATE ON photo_groups
FOR EACH ROW EXECUTE FUNCTION inventory_guard_photo_revision();
