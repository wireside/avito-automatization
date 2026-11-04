CREATE TABLE "marking_signing_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"seller_inn" text NOT NULL,
	"simulated" boolean NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"signer_id" text,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"signature_ciphertext" text,
	"signature_key_id" text,
	"signature_identity_hash" text,
	"signature_hash" text,
	"verified_payload_hash" text,
	"verification_source" text,
	"received_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marking_signing_tasks_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
ALTER TABLE "marking_signing_tasks" ADD CONSTRAINT "marking_signing_tasks_document_id_chz_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."chz_documents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE marking_signing_tasks ADD CONSTRAINT signing_task_state_check CHECK(status IN ('PENDING','LEASED','RECEIVED','VERIFIED'));
--> statement-breakpoint
ALTER TABLE marking_signing_tasks ADD CONSTRAINT signing_task_verified_check CHECK(status<>'VERIFIED' OR (verified_payload_hash IS NOT NULL AND signature_ciphertext IS NOT NULL AND verified_at IS NOT NULL AND verification_source IN ('SIMULATION','CRYPTOGRAPHIC')));
--> statement-breakpoint
CREATE FUNCTION marking_guard_signing_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain signature evidence' USING ERRCODE='23514'; END IF;
 IF (NEW.document_id,NEW.seller_inn,NEW.simulated) IS DISTINCT FROM (OLD.document_id,OLD.seller_inn,OLD.simulated) OR OLD.status='VERIFIED' THEN
  RAISE EXCEPTION 'Frozen signing task cannot be retargeted or rewritten' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER marking_signing_task_guard BEFORE UPDATE OR DELETE ON marking_signing_tasks FOR EACH ROW EXECUTE FUNCTION marking_guard_signing_task();
