CREATE TABLE "marking_provider_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"identity_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marking_provider_receipts" ADD CONSTRAINT "marking_provider_receipts_document_id_chz_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."chz_documents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER marking_provider_receipts_immutable BEFORE UPDATE OR DELETE ON marking_provider_receipts FOR EACH ROW EXECUTE FUNCTION inventory_reject_history_mutation();
--> statement-breakpoint
CREATE INDEX marking_provider_receipts_document_idx ON marking_provider_receipts(document_id,created_at DESC);
