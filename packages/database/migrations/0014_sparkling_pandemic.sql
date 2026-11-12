CREATE TABLE "chz_connection_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"seller_inn" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chz_connection_singleton" CHECK ("chz_connection_settings"."id"=1),
	CONSTRAINT "chz_connection_inn" CHECK ("chz_connection_settings"."seller_inn" ~ '^[0-9]{12}$')
);
--> statement-breakpoint
ALTER TABLE "marking_pipeline_settings" ALTER COLUMN "fiscal_evidence_reference" DROP NOT NULL;
--> statement-breakpoint
-- Keep previously configured seller identity; no warehouse is required for new connections.
INSERT INTO chz_connection_settings(id,seller_inn)
SELECT 1,seller_inn FROM marking_pipeline_settings ORDER BY warehouse_id LIMIT 1
ON CONFLICT(id) DO NOTHING;
