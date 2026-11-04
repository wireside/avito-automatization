CREATE TABLE "marking_business_days" (
	"date" text PRIMARY KEY NOT NULL,
	"working" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marking_command_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marking_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"code" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "marking_issues_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "marking_pipeline_settings" (
	"warehouse_id" uuid PRIMARY KEY NOT NULL,
	"seller_inn" text NOT NULL,
	"fias_id" uuid NOT NULL,
	"address" text NOT NULL,
	"fiscal_evidence_reference" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marking_simulation_documents" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"external_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"payload_hash" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marking_simulation_units" (
	"unit_id" uuid PRIMARY KEY NOT NULL,
	"provider_state" text NOT NULL,
	"owner_inn" text NOT NULL,
	"outcome" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marking_supply_evidence" (
	"unit_id" uuid PRIMARY KEY NOT NULL,
	"document_number" text NOT NULL,
	"document_date" text NOT NULL,
	"supplier_inn" text NOT NULL,
	"evidence_reference" text NOT NULL,
	"simulated" boolean NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "marking_command_results" ADD CONSTRAINT "marking_command_results_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marking_pipeline_settings" ADD CONSTRAINT "marking_pipeline_settings_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marking_simulation_units" ADD CONSTRAINT "marking_simulation_units_unit_id_product_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marking_supply_evidence" ADD CONSTRAINT "marking_supply_evidence_unit_id_product_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;