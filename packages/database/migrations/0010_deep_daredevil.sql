-- Preserve retired encrypted evidence outside the application schema; never promote it to provider facts.
CREATE SCHEMA IF NOT EXISTS retired_marking;
--> statement-breakpoint
CREATE TABLE retired_marking.signing_tasks AS TABLE marking_signing_tasks;
--> statement-breakpoint
CREATE TABLE retired_marking.provider_documents AS TABLE marking_simulation_documents;
--> statement-breakpoint
CREATE TABLE retired_marking.provider_units AS TABLE marking_simulation_units;
--> statement-breakpoint
DROP TRIGGER marking_supply_evidence_identity ON marking_supply_evidence;
--> statement-breakpoint
UPDATE marking_supply_evidence SET verified_at=NULL;
--> statement-breakpoint
UPDATE integration_operations SET status='CANCELLED',last_error_code='RETIRED_RUNTIME' WHERE operation_type LIKE 'pipeline.%' AND status IN ('PENDING','RUNNING','RETRY_SCHEDULED','MANUAL_ATTENTION');
--> statement-breakpoint
CREATE TABLE "chz_sessions" (
	"seller_inn" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"key_id" text NOT NULL,
	"identity_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signer_devices" (
	"signer_id" text PRIMARY KEY NOT NULL,
	"certificate_thumbprint" text NOT NULL,
	"certificate_expires_at" timestamp with time zone NOT NULL,
	"ready" boolean NOT NULL,
	"error_code" text,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signer_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"purpose" text NOT NULL,
	"document_type" text NOT NULL,
	"seller_inn" text NOT NULL,
	"auth_uuid" text,
	"payload_ciphertext" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"identity_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"signer_id" text,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"signature_ciphertext" text,
	"signature_key_id" text,
	"signature_identity_hash" text,
	"signature_hash" text,
	"certificate_thumbprint" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signer_jobs_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
DROP TABLE "marking_signing_tasks" CASCADE;--> statement-breakpoint
DROP TABLE "marking_simulation_documents" CASCADE;--> statement-breakpoint
DROP TABLE "marking_simulation_units" CASCADE;--> statement-breakpoint
ALTER TABLE "chz_documents" ADD COLUMN "submission_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marking_supply_evidence" ADD COLUMN "provider_document_id" text;--> statement-breakpoint
ALTER TABLE "signer_jobs" ADD CONSTRAINT "signer_jobs_document_id_chz_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."chz_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marking_supply_evidence" DROP COLUMN "simulated";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION marking_guard_supply_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain supply evidence' USING ERRCODE='23514';END IF;
 IF (NEW.unit_id,NEW.document_number,NEW.document_date,NEW.supplier_inn,NEW.evidence_reference) IS DISTINCT FROM (OLD.unit_id,OLD.document_number,OLD.document_date,OLD.supplier_inn,OLD.evidence_reference) THEN RAISE EXCEPTION 'Supply evidence identity is immutable' USING ERRCODE='23514';END IF;
 IF OLD.provider_document_id IS NOT NULL AND NEW.provider_document_id IS DISTINCT FROM OLD.provider_document_id THEN RAISE EXCEPTION 'Provider document identity is immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER marking_supply_evidence_identity BEFORE UPDATE OR DELETE ON marking_supply_evidence FOR EACH ROW EXECUTE FUNCTION marking_guard_supply_evidence();
--> statement-breakpoint
ALTER TABLE signer_jobs ADD CONSTRAINT signer_jobs_state_check CHECK(status IN ('PENDING','LEASED','VERIFIED','COMPLETED','EXPIRED','REJECTED'));
--> statement-breakpoint
ALTER TABLE signer_jobs ADD CONSTRAINT signer_jobs_purpose_check CHECK((purpose='AUTH' AND document_id IS NULL AND auth_uuid IS NOT NULL) OR(purpose='DOCUMENT' AND document_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE signer_jobs ADD CONSTRAINT signer_jobs_verification_check CHECK(status NOT IN ('VERIFIED','COMPLETED') OR(signature_ciphertext IS NOT NULL AND signature_hash IS NOT NULL AND verified_at IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX signer_jobs_one_auth_pending ON signer_jobs(seller_inn) WHERE purpose='AUTH' AND status IN ('PENDING','LEASED','VERIFIED');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_live_signer_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain signing history' USING ERRCODE='23514';END IF;
 IF (NEW.document_id,NEW.purpose,NEW.document_type,NEW.seller_inn,NEW.auth_uuid,NEW.payload_ciphertext,NEW.encryption_key_id,NEW.identity_hash,NEW.payload_hash) IS DISTINCT FROM(OLD.document_id,OLD.purpose,OLD.document_type,OLD.seller_inn,OLD.auth_uuid,OLD.payload_ciphertext,OLD.encryption_key_id,OLD.identity_hash,OLD.payload_hash) OR (NEW.expires_at IS DISTINCT FROM OLD.expires_at AND NOT (OLD.purpose='DOCUMENT' AND OLD.status IN ('PENDING','LEASED') AND NEW.status='PENDING' AND NEW.expires_at>OLD.expires_at)) OR (OLD.status IN ('VERIFIED','COMPLETED') AND (NEW.signature_ciphertext,NEW.signature_hash,NEW.certificate_thumbprint) IS DISTINCT FROM(OLD.signature_ciphertext,OLD.signature_hash,OLD.certificate_thumbprint)) THEN RAISE EXCEPTION 'Signing bytes and completed signature are immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER live_signer_job_identity BEFORE UPDATE OR DELETE ON signer_jobs FOR EACH ROW EXECUTE FUNCTION guard_live_signer_job();
