ALTER TABLE "marking_document_artifacts" ADD CONSTRAINT "marking_document_artifacts_document_id_chz_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."chz_documents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- marking_pipeline_history_guards: command responses and frozen documents retain evidence.
CREATE TRIGGER marking_commands_immutable BEFORE UPDATE OR DELETE ON marking_command_results FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER marking_document_artifacts_immutable BEFORE UPDATE OR DELETE ON marking_document_artifacts FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER marking_simulation_documents_immutable BEFORE UPDATE OR DELETE ON marking_simulation_documents FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_mutation();
--> statement-breakpoint
ALTER TABLE marking_document_artifacts ADD CONSTRAINT marking_artifact_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$' AND identity_hash ~ '^[0-9a-f]{64}$' AND byte_length>0);
--> statement-breakpoint
ALTER TABLE marking_pipeline_settings ADD CONSTRAINT marking_seller_inn_check CHECK(seller_inn ~ '^[0-9]{12}$');
--> statement-breakpoint
CREATE FUNCTION marking_guard_supply_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain supply evidence' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.unit_id,NEW.document_number,NEW.document_date,NEW.supplier_inn,NEW.evidence_reference,NEW.simulated) IS DISTINCT FROM (OLD.unit_id,OLD.document_number,OLD.document_date,OLD.supplier_inn,OLD.evidence_reference,OLD.simulated) THEN
  RAISE EXCEPTION 'Supply evidence identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER marking_supply_evidence_identity BEFORE UPDATE OR DELETE ON marking_supply_evidence FOR EACH ROW EXECUTE FUNCTION marking_guard_supply_evidence();
