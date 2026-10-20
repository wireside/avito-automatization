CREATE TYPE "public"."catalog_review" AS ENUM('UNRESOLVED', 'REVIEW_REQUIRED', 'VERIFIED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."data_source" AS ENUM('CHZ', 'NATIONAL_CATALOG', 'SUPPLIER_API', 'EDI', 'FILE_IMPORT', 'MANUAL', 'MIGRATION');--> statement-breakpoint
CREATE TYPE "public"."document_verification" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."inventory_operation_kind" AS ENUM('RECEIPT', 'RELEASE', 'RESERVE', 'RELEASE_RESERVATION', 'PACK', 'UNPACK', 'PREPARE_SHIPMENT', 'SHIP', 'DELIVER', 'START_RETURN', 'RETURN', 'TRANSFER', 'DEFECT', 'LOSS', 'DISPOSE', 'SUPPLIER_RETURN', 'COUNT', 'CORRECTION', 'COST_UPDATE', 'MARKING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."stock_location_kind" AS ENUM('SELLABLE', 'QUARANTINE', 'DEFECT', 'STAGING');--> statement-breakpoint
CREATE TYPE "public"."unit_physical_state" AS ENUM('NOT_RECEIVED', 'QUARANTINE', 'AVAILABLE', 'PACKING', 'IN_TRANSIT', 'WITH_CUSTOMER', 'RETURN_IN_TRANSIT', 'DEFECTIVE', 'LOST', 'DISPOSED', 'WITH_SUPPLIER');--> statement-breakpoint
CREATE TYPE "public"."stock_receipt_status" AS ENUM('DRAFT', 'POSTED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."avito_marking_status" AS ENUM('NOT_REQUIRED', 'NOT_SENT', 'PENDING', 'ACCEPTED', 'REJECTED', 'UNKNOWN_RESULT');--> statement-breakpoint
CREATE TYPE "public"."warehouse_order_status" AS ENUM('NEW', 'MAPPING_REQUIRED', 'RESERVED', 'PICKING', 'MARKING_PENDING', 'PACKED', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURN_IN_TRANSIT', 'RETURNED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."inventory_reservation_status" AS ENUM('ACTIVE', 'RELEASED', 'CONSUMED');--> statement-breakpoint
CREATE TYPE "public"."chz_action" AS ENUM('WITHDRAW', 'RETURN', 'WRITE_OFF', 'REMARK', 'CORRECT');--> statement-breakpoint
CREATE TYPE "public"."chz_legal_state" AS ENUM('UNKNOWN', 'IN_CIRCULATION', 'WITHDRAWN', 'WRITTEN_OFF', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."chz_submission_mode" AS ENUM('AVITO_OFD', 'CHZ_MANUAL', 'DIRECT_TRUE_API');--> statement-breakpoint
CREATE TYPE "public"."chz_progress" AS ENUM('PREPARING', 'WAITING_SIGNATURE', 'SUBMITTED', 'PROCESSING', 'CONFIRMED', 'REJECTED', 'UNKNOWN_RESULT', 'MANUAL_ATTENTION', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "catalog_attribute_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"source" "data_source" NOT NULL,
	"source_reference" text NOT NULL,
	"attributes" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "classification_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tnved" varchar(10) NOT NULL,
	"okpd2" varchar(12) NOT NULL,
	"applicability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "data_source" NOT NULL,
	"source_reference" text NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classification_tnved_check" CHECK ("classification_profiles"."tnved" ~ '^[0-9]{10}$'),
	CONSTRAINT "classification_okpd2_check" CHECK ("classification_profiles"."okpd2" ~ '^[0-9]{2}[.][0-9]{2}[.][0-9]{2}[.][0-9]{3}$'),
	CONSTRAINT "classification_verifier_check" CHECK (("classification_profiles"."verified_at" IS NULL) = ("classification_profiles"."verified_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "compliance_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"registry_url" text,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"source" "data_source" NOT NULL,
	"source_reference" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_kind_number_uq" UNIQUE("kind","number"),
	CONSTRAINT "compliance_dates_check" CHECK ("compliance_documents"."valid_until" IS NULL OR "compliance_documents"."valid_from" IS NULL OR "compliance_documents"."valid_until" >= "compliance_documents"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "counterparties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"inn" varchar(12),
	"kpp" varchar(9),
	"external_namespace" text,
	"external_id" text,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"is_manufacturer" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counterparties_inn_check" CHECK ("counterparties"."inn" IS NULL OR "counterparties"."inn" ~ '^([0-9]{10}|[0-9]{12})$'),
	CONSTRAINT "counterparties_kpp_check" CHECK ("counterparties"."kpp" IS NULL OR ("counterparties"."kpp" ~ '^[0-9]{9}$' AND "counterparties"."inn" IS NOT NULL AND length("counterparties"."inn") = 10))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"uploaded_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_dimensions_check" CHECK ("media_assets"."byte_size" > 0 AND "media_assets"."width" > 0 AND "media_assets"."height" > 0),
	CONSTRAINT "media_hash_check" CHECK ("media_assets"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "photo_group_items" (
	"group_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "photo_group_items_group_id_position_pk" PRIMARY KEY("group_id","position"),
	CONSTRAINT "photo_group_asset_uq" UNIQUE("group_id","asset_id"),
	CONSTRAINT "photo_position_check" CHECK ("photo_group_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "photo_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_groups_revision_uq" UNIQUE("group_key","revision"),
	CONSTRAINT "photo_revision_check" CHECK ("photo_groups"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_compliance_documents" (
	"product_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	CONSTRAINT "product_compliance_documents_product_id_document_id_pk" PRIMARY KEY("product_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "product_photo_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"color" text,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_binding_target_check" CHECK (("product_photo_bindings"."product_id" IS NOT NULL AND "product_photo_bindings"."variant_id" IS NULL) OR ("product_photo_bindings"."product_id" IS NULL AND "product_photo_bindings"."variant_id" IS NOT NULL AND "product_photo_bindings"."color" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"size_label" text,
	"size_system" text,
	"height_label" text,
	"material_composition" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"classification_profile_id" uuid,
	"review_status" "catalog_review" DEFAULT 'UNRESOLVED' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sku_unique" UNIQUE("sku"),
	CONSTRAINT "variants_verified_model_check" CHECK ("product_variants"."review_status" <> 'VERIFIED' OR "product_variants"."product_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"manufacturer_id" uuid,
	"brand" text,
	"manufacturer_article" text,
	"model_discriminator" text DEFAULT '' NOT NULL,
	"description" text,
	"classification_profile_id" uuid,
	"review_status" "catalog_review" DEFAULT 'UNRESOLVED' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"gtin" varchar(14) NOT NULL,
	"source" "data_source" NOT NULL,
	"source_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_identifiers_gtin_unique" UNIQUE("gtin"),
	CONSTRAINT "variant_identifiers_id_variant_uq" UNIQUE("id","variant_id"),
	CONSTRAINT "variant_identifiers_gtin_check" CHECK ("variant_identifiers"."gtin" ~ '^[0-9]{14}$')
);
--> statement-breakpoint
CREATE TABLE "cost_layer_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cost_layer_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"unit_cost_kopecks" bigint NOT NULL,
	"source" "data_source" NOT NULL,
	"source_reference" text NOT NULL,
	"supply_document_item_id" uuid,
	"tax_treatment" text NOT NULL,
	"currency" varchar(3) DEFAULT 'RUB' NOT NULL,
	"operation_id" uuid NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_layer_price_revision_uq" UNIQUE("cost_layer_id","revision"),
	CONSTRAINT "cost_layer_price_check" CHECK ("cost_layer_prices"."revision" > 0 AND "cost_layer_prices"."unit_cost_kopecks" >= 0 AND "cost_layer_prices"."currency" = 'RUB')
);
--> statement-breakpoint
CREATE TABLE "cost_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_item_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_layers_receipt_item_id_unique" UNIQUE("receipt_item_id"),
	CONSTRAINT "cost_layers_id_variant_uq" UNIQUE("id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_count_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"expected" boolean NOT NULL,
	"expected_location_id" uuid,
	"expected_state" "unit_physical_state",
	"expected_movement_revision" integer,
	"counted_location_id" uuid,
	"counted_at" timestamp with time zone,
	"counted_by" uuid,
	"resolution_reason" text,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_count_unit_uq" UNIQUE("count_id","unit_id"),
	CONSTRAINT "inventory_count_snapshot_check" CHECK (NOT "inventory_count_items"."expected" OR ("inventory_count_items"."expected_state" IS NOT NULL AND "inventory_count_items"."expected_movement_revision" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_counts_status_check" CHECK ("inventory_counts"."status" IN ('OPEN', 'REVIEW', 'POSTED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "inventory_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "inventory_operation_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"shift_id" uuid,
	"source" text NOT NULL,
	"reason" text,
	"correlation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_operations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "inventory_actor_check" CHECK (("inventory_operations"."actor_kind" = 'USER' AND "inventory_operations"."actor_user_id" IS NOT NULL) OR ("inventory_operations"."actor_kind" IN ('SYSTEM', 'IMPORT') AND "inventory_operations"."actor_user_id" IS NULL)),
	CONSTRAINT "inventory_reason_check" CHECK ("inventory_operations"."kind" NOT IN ('CORRECTION', 'LOSS', 'DISPOSE', 'DEFECT') OR length(btrim("inventory_operations"."reason")) > 0 AND "inventory_operations"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "product_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internal_code" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"cost_layer_id" uuid NOT NULL,
	"current_state" "unit_physical_state" DEFAULT 'NOT_RECEIVED' NOT NULL,
	"current_location_id" uuid,
	"movement_revision" integer DEFAULT 0 NOT NULL,
	"created_by_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_units_internal_code_unique" UNIQUE("internal_code"),
	CONSTRAINT "product_units_id_variant_uq" UNIQUE("id","variant_id"),
	CONSTRAINT "product_units_revision_check" CHECK ("product_units"."movement_revision" >= 0),
	CONSTRAINT "product_units_location_check" CHECK (("product_units"."current_state" IN ('AVAILABLE', 'PACKING', 'QUARANTINE', 'DEFECTIVE')) = ("product_units"."current_location_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "stock_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "stock_location_kind" NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_locations_code_uq" UNIQUE("warehouse_id","code"),
	CONSTRAINT "stock_locations_id_warehouse_uq" UNIQUE("id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "stock_receipt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"supply_document_item_id" uuid,
	"expected_quantity" integer NOT NULL,
	CONSTRAINT "receipt_items_id_variant_uq" UNIQUE("id","variant_id"),
	CONSTRAINT "receipt_items_quantity_check" CHECK ("stock_receipt_items"."expected_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"supplier_id" uuid,
	"supply_document_id" uuid,
	"status" "stock_receipt_status" DEFAULT 'DRAFT' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_receipts_number_unique" UNIQUE("number"),
	CONSTRAINT "stock_receipts_id_warehouse_uq" UNIQUE("id","warehouse_id"),
	CONSTRAINT "receipt_posted_time_check" CHECK ("stock_receipts"."status" = 'DRAFT' OR "stock_receipts"."posted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "supply_document_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"line_key" text NOT NULL,
	"variant_id" uuid,
	"supplier_article" text,
	"supplier_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_kopecks" bigint,
	"tax_treatment" text NOT NULL,
	"currency" varchar(3) DEFAULT 'RUB' NOT NULL,
	CONSTRAINT "supply_document_line_uq" UNIQUE("document_id","line_key"),
	CONSTRAINT "supply_document_quantity_check" CHECK ("supply_document_items"."quantity" > 0),
	CONSTRAINT "supply_document_cost_check" CHECK ("supply_document_items"."unit_cost_kopecks" IS NULL OR "supply_document_items"."unit_cost_kopecks" >= 0),
	CONSTRAINT "supply_document_currency_check" CHECK ("supply_document_items"."currency" = 'RUB')
);
--> statement-breakpoint
CREATE TABLE "supply_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"source" "data_source" NOT NULL,
	"source_reference" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"number" text,
	"document_at" timestamp with time zone,
	"verification_status" "document_verification" DEFAULT 'PENDING' NOT NULL,
	"verified_at" timestamp with time zone,
	"content_hash" varchar(64),
	"storage_key" text,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supply_documents_source_revision_uq" UNIQUE("source","source_reference","revision"),
	CONSTRAINT "supply_documents_revision_check" CHECK ("supply_documents"."revision" > 0),
	CONSTRAINT "supply_documents_verified_check" CHECK ("supply_documents"."verification_status" <> 'VERIFIED' OR "supply_documents"."verified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "unit_markings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"variant_identifier_id" uuid NOT NULL,
	"identity_hash" varchar(64) NOT NULL,
	"masked_code" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"parser_profile" text NOT NULL,
	"scanner_profile" text NOT NULL,
	"supersedes_marking_id" uuid,
	"retired_at" timestamp with time zone,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_markings_identity_hash_unique" UNIQUE("identity_hash"),
	CONSTRAINT "unit_markings_hash_check" CHECK ("unit_markings"."identity_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "unit_markings_payload_check" CHECK (length("unit_markings"."payload_ciphertext") > 0 AND length("unit_markings"."encryption_key_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"fias_id" uuid,
	"address" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "work_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "work_shifts_dates_check" CHECK ("work_shifts"."closed_at" IS NULL OR "work_shifts"."closed_at" >= "work_shifts"."opened_at")
);
--> statement-breakpoint
CREATE TABLE "avito_item_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"external_variant_key" text,
	"allocation_limit" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avito_item_allocation_check" CHECK ("avito_item_variants"."allocation_limit" IS NULL OR "avito_item_variants"."allocation_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "avito_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_item_id" text,
	"external_key" text NOT NULL,
	"product_id" uuid,
	"photo_group_id" uuid,
	"title" text NOT NULL,
	"provider_status" text,
	"content_revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avito_items_external_id_uq" UNIQUE("channel_id","external_item_id"),
	CONSTRAINT "avito_items_external_key_uq" UNIQUE("channel_id","external_key"),
	CONSTRAINT "avito_items_id_channel_uq" UNIQUE("id","channel_id"),
	CONSTRAINT "avito_items_revision_check" CHECK ("avito_items"."content_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" "inventory_reservation_status" DEFAULT 'ACTIVE' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_id_item_unit_uq" UNIQUE("id","order_item_id","unit_id"),
	CONSTRAINT "reservation_end_check" CHECK (("inventory_reservations"."status" = 'ACTIVE' AND "inventory_reservations"."ended_at" IS NULL) OR ("inventory_reservations"."status" <> 'ACTIVE' AND "inventory_reservations"."ended_at" IS NOT NULL AND "inventory_reservations"."ended_at" >= "inventory_reservations"."reserved_at"))
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_line_key" text NOT NULL,
	"listing_id" uuid,
	"variant_id" uuid,
	"title_snapshot" text NOT NULL,
	"variant_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_kopecks" bigint,
	"mapping_status" text DEFAULT 'REQUIRED' NOT NULL,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_line_uq" UNIQUE("order_id","external_line_key"),
	CONSTRAINT "order_items_id_variant_uq" UNIQUE("id","variant_id"),
	CONSTRAINT "order_items_id_order_uq" UNIQUE("id","order_id"),
	CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" > 0 AND ("order_items"."unit_price_kopecks" IS NULL OR "order_items"."unit_price_kopecks" >= 0)),
	CONSTRAINT "order_items_mapping_check" CHECK (("order_items"."mapping_status" = 'REQUIRED' AND "order_items"."variant_id" IS NULL) OR ("order_items"."mapping_status" = 'VERIFIED' AND "order_items"."variant_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "order_unit_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_cycle_id" uuid NOT NULL,
	"packed_at" timestamp with time zone,
	"avito_marking_status" "avito_marking_status" DEFAULT 'NOT_SENT' NOT NULL,
	"provider_confirmed_at" timestamp with time zone,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_unit_assignments_sale_cycle_id_unique" UNIQUE("sale_cycle_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_order_id" text NOT NULL,
	"status" "warehouse_order_status" DEFAULT 'NEW' NOT NULL,
	"provider_status" text NOT NULL,
	"available_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"provider_updated_at" timestamp with time zone NOT NULL,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_channel_external_uq" UNIQUE("channel_id","external_order_id"),
	CONSTRAINT "orders_id_channel_uq" UNIQUE("id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"shipment_item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"condition" text DEFAULT 'UNCHECKED' NOT NULL,
	"inspected_at" timestamp with time zone,
	"inspection_note" text,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_items_shipment_item_uq" UNIQUE("shipment_item_id"),
	CONSTRAINT "return_items_id_unit_uq" UNIQUE("id","unit_id"),
	CONSTRAINT "return_item_condition_check" CHECK ("return_items"."condition" IN ('UNCHECKED', 'GOOD', 'DEFECTIVE', 'DAMAGED_CODE', 'WRONG_ITEM'))
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"external_return_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'EXPECTED' NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"received_at" timestamp with time zone,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "returns_order_external_uq" UNIQUE("order_id","external_return_id"),
	CONSTRAINT "return_kind_check" CHECK ("returns"."kind" IN ('CUSTOMER', 'UNCLAIMED', 'CANCELLED_SHIPMENT')),
	CONSTRAINT "return_status_check" CHECK ("returns"."status" IN ('EXPECTED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'DISPUTED'))
);
--> statement-breakpoint
CREATE TABLE "sale_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"cycle_number" integer NOT NULL,
	"purchase_cost_revision_id" uuid,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_cycles_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "sale_cycles_unit_number_uq" UNIQUE("unit_id","cycle_number"),
	CONSTRAINT "sale_cycles_id_unit_uq" UNIQUE("id","unit_id"),
	CONSTRAINT "sale_cycle_number_check" CHECK ("sale_cycles"."cycle_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'AVITO' NOT NULL,
	"external_account_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_channels_account_uq" UNIQUE("provider","external_account_id")
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"sale_cycle_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_items_id_unit_uq" UNIQUE("id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"parcel_code" text NOT NULL,
	"external_shipment_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"composition_revision" integer DEFAULT 1 NOT NULL,
	"prepared_at" timestamp with time zone,
	"handed_over_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"handover_source" text,
	"handover_evidence_reference" text,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_parcel_code_unique" UNIQUE("parcel_code"),
	CONSTRAINT "shipments_id_order_uq" UNIQUE("id","order_id"),
	CONSTRAINT "shipment_status_check" CHECK ("shipments"."status" IN ('DRAFT', 'PACKED', 'READY', 'HANDED_OVER', 'DELIVERED', 'CANCELLED')),
	CONSTRAINT "shipment_revision_check" CHECK ("shipments"."composition_revision" > 0),
	CONSTRAINT "shipment_handover_check" CHECK ("shipments"."status" NOT IN ('HANDED_OVER', 'DELIVERED') OR ("shipments"."handed_over_at" IS NOT NULL AND "shipments"."handover_source" IS NOT NULL)),
	CONSTRAINT "shipment_delivery_check" CHECK ("shipments"."delivered_at" IS NULL OR ("shipments"."handed_over_at" IS NOT NULL AND "shipments"."delivered_at" >= "shipments"."handed_over_at"))
);
--> statement-breakpoint
CREATE TABLE "inventory_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inventory_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operation_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_status" text,
	"next_status" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inventory_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operation_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"unit_revision" integer NOT NULL,
	"from_state" "unit_physical_state" NOT NULL,
	"to_state" "unit_physical_state" NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"shipment_item_id" uuid,
	"return_item_id" uuid,
	"count_id" uuid,
	"reverses_movement_id" bigint,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_unit_revision_uq" UNIQUE("unit_id","unit_revision"),
	CONSTRAINT "inventory_movements_operation_unit_uq" UNIQUE("operation_id","unit_id"),
	CONSTRAINT "inventory_movements_reversal_uq" UNIQUE("reverses_movement_id"),
	CONSTRAINT "movement_revision_check" CHECK ("inventory_movements"."unit_revision" > 0),
	CONSTRAINT "movement_changes_check" CHECK ("inventory_movements"."from_state" <> "inventory_movements"."to_state" OR "inventory_movements"."from_location_id" IS DISTINCT FROM "inventory_movements"."to_location_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"receipt_id" uuid,
	"shipment_id" uuid,
	"return_id" uuid,
	"count_id" uuid,
	"unit_id" uuid,
	"marking_id" uuid,
	"result" text NOT NULL,
	"error_code" text,
	"scanner_profile" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_scans_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "inventory_scan_context_check" CHECK (num_nonnulls("inventory_scans"."receipt_id","inventory_scans"."shipment_id","inventory_scans"."return_id","inventory_scans"."count_id") = 1),
	CONSTRAINT "inventory_scan_result_check" CHECK ("inventory_scans"."result" IN ('ACCEPTED','DUPLICATE','INVALID','UNKNOWN','MISMATCH')),
	CONSTRAINT "inventory_scan_fingerprint_check" CHECK ("inventory_scans"."input_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "chz_document_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chz_operation_id" uuid NOT NULL,
	"status" "chz_progress" DEFAULT 'PREPARING' NOT NULL,
	"error_code" text,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chz_document_operation_uq" UNIQUE("document_id","chz_operation_id")
);
--> statement-breakpoint
CREATE TABLE "chz_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_mode" "chz_submission_mode" NOT NULL,
	"external_document_id" text,
	"action" "chz_action" NOT NULL,
	"warehouse_id" uuid,
	"schema_version" text NOT NULL,
	"payload_hash" text,
	"status" "chz_progress" DEFAULT 'PREPARING' NOT NULL,
	"provider_status" text,
	"submitted_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chz_documents_external_uq" UNIQUE("submission_mode","external_document_id")
);
--> statement-breakpoint
CREATE TABLE "chz_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marking_id" uuid NOT NULL,
	"action" "chz_action" NOT NULL,
	"reason" text NOT NULL,
	"sale_cycle_id" uuid,
	"shipment_id" uuid,
	"return_id" uuid,
	"submission_mode" "chz_submission_mode" NOT NULL,
	"status" "chz_progress" DEFAULT 'PREPARING' NOT NULL,
	"idempotency_key" text NOT NULL,
	"integration_operation_id" uuid,
	"effective_at" timestamp with time zone NOT NULL,
	"submission_due_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"last_operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chz_operations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "chz_operations_sale_action_uq" UNIQUE("marking_id","sale_cycle_id","action"),
	CONSTRAINT "chz_sale_cycle_check" CHECK ("chz_operations"."action" NOT IN ('WITHDRAW', 'RETURN') OR "chz_operations"."sale_cycle_id" IS NOT NULL),
	CONSTRAINT "chz_confirmation_check" CHECK ("chz_operations"."status" <> 'CONFIRMED' OR "chz_operations"."confirmed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "unit_marking_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unit_marking_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"marking_id" uuid NOT NULL,
	"state" "chz_legal_state" NOT NULL,
	"provider_state" text NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text NOT NULL,
	"ownership_verified" text NOT NULL,
	"chz_document_item_id" uuid,
	"operation_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marking_events_source_uq" UNIQUE("source","source_event_id"),
	CONSTRAINT "marking_events_ownership_check" CHECK ("unit_marking_events"."ownership_verified" IN ('UNKNOWN', 'VERIFIED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "catalog_attribute_sources" ADD CONSTRAINT "catalog_attribute_sources_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_attribute_sources" ADD CONSTRAINT "catalog_attribute_sources_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_profiles" ADD CONSTRAINT "classification_profiles_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_group_items" ADD CONSTRAINT "photo_group_items_group_id_photo_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."photo_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_group_items" ADD CONSTRAINT "photo_group_items_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_groups" ADD CONSTRAINT "photo_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_compliance_documents" ADD CONSTRAINT "product_compliance_documents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_compliance_documents" ADD CONSTRAINT "product_compliance_documents_document_id_compliance_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."compliance_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photo_bindings" ADD CONSTRAINT "product_photo_bindings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photo_bindings" ADD CONSTRAINT "product_photo_bindings_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photo_bindings" ADD CONSTRAINT "product_photo_bindings_group_id_photo_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."photo_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_classification_profile_id_classification_profiles_id_fk" FOREIGN KEY ("classification_profile_id") REFERENCES "public"."classification_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_manufacturer_id_counterparties_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_classification_profile_id_classification_profiles_id_fk" FOREIGN KEY ("classification_profile_id") REFERENCES "public"."classification_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_identifiers" ADD CONSTRAINT "variant_identifiers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_layer_prices" ADD CONSTRAINT "cost_layer_prices_cost_layer_id_cost_layers_id_fk" FOREIGN KEY ("cost_layer_id") REFERENCES "public"."cost_layers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_layer_prices" ADD CONSTRAINT "cost_layer_prices_supply_document_item_id_supply_document_items_id_fk" FOREIGN KEY ("supply_document_item_id") REFERENCES "public"."supply_document_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_layer_prices" ADD CONSTRAINT "cost_layer_prices_operation_id_inventory_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_receipt_variant_fk" FOREIGN KEY ("receipt_item_id","variant_id") REFERENCES "public"."stock_receipt_items"("id","variant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_unit_id_product_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_expected_location_id_stock_locations_id_fk" FOREIGN KEY ("expected_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_counted_location_id_stock_locations_id_fk" FOREIGN KEY ("counted_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_location_warehouse_fk" FOREIGN KEY ("location_id","warehouse_id") REFERENCES "public"."stock_locations"("id","warehouse_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_operations" ADD CONSTRAINT "inventory_operations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_operations" ADD CONSTRAINT "inventory_operations_shift_id_work_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."work_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_current_location_id_stock_locations_id_fk" FOREIGN KEY ("current_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_created_by_operation_id_inventory_operations_id_fk" FOREIGN KEY ("created_by_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_cost_variant_fk" FOREIGN KEY ("cost_layer_id","variant_id") REFERENCES "public"."cost_layers"("id","variant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_items" ADD CONSTRAINT "stock_receipt_items_supply_document_item_id_supply_document_items_id_fk" FOREIGN KEY ("supply_document_item_id") REFERENCES "public"."supply_document_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_supplier_id_counterparties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_supply_document_id_supply_documents_id_fk" FOREIGN KEY ("supply_document_id") REFERENCES "public"."supply_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_document_items" ADD CONSTRAINT "supply_document_items_document_id_supply_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."supply_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_document_items" ADD CONSTRAINT "supply_document_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_documents" ADD CONSTRAINT "supply_documents_supplier_id_counterparties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_documents" ADD CONSTRAINT "supply_documents_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_markings" ADD CONSTRAINT "unit_markings_supersedes_marking_id_unit_markings_id_fk" FOREIGN KEY ("supersedes_marking_id") REFERENCES "public"."unit_markings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_markings" ADD CONSTRAINT "unit_markings_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_markings" ADD CONSTRAINT "unit_markings_unit_variant_fk" FOREIGN KEY ("unit_id","variant_id") REFERENCES "public"."product_units"("id","variant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_markings" ADD CONSTRAINT "unit_markings_gtin_variant_fk" FOREIGN KEY ("variant_identifier_id","variant_id") REFERENCES "public"."variant_identifiers"("id","variant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avito_item_variants" ADD CONSTRAINT "avito_item_variants_item_id_avito_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."avito_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avito_item_variants" ADD CONSTRAINT "avito_item_variants_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avito_items" ADD CONSTRAINT "avito_items_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avito_items" ADD CONSTRAINT "avito_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avito_items" ADD CONSTRAINT "avito_items_photo_group_id_photo_groups_id_fk" FOREIGN KEY ("photo_group_id") REFERENCES "public"."photo_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "reservations_order_variant_fk" FOREIGN KEY ("order_item_id","variant_id") REFERENCES "public"."order_items"("id","variant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "reservations_unit_variant_fk" FOREIGN KEY ("unit_id","variant_id") REFERENCES "public"."product_units"("id","variant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_channel_fk" FOREIGN KEY ("order_id","channel_id") REFERENCES "public"."orders"("id","channel_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_listing_channel_fk" FOREIGN KEY ("listing_id","channel_id") REFERENCES "public"."avito_items"("id","channel_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_unit_assignments" ADD CONSTRAINT "order_unit_assignments_sale_cycle_id_sale_cycles_id_fk" FOREIGN KEY ("sale_cycle_id") REFERENCES "public"."sale_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_unit_assignments" ADD CONSTRAINT "order_unit_assignments_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_channel_id_sales_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."sales_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_shipment_unit_fk" FOREIGN KEY ("shipment_item_id","unit_id") REFERENCES "public"."shipment_items"("id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_cycles" ADD CONSTRAINT "sale_cycles_purchase_cost_revision_id_cost_layer_prices_id_fk" FOREIGN KEY ("purchase_cost_revision_id") REFERENCES "public"."cost_layer_prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_cycles" ADD CONSTRAINT "sale_cycles_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_cycles" ADD CONSTRAINT "sale_cycles_reservation_fk" FOREIGN KEY ("reservation_id","order_item_id","unit_id") REFERENCES "public"."inventory_reservations"("id","order_item_id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_cycle_unit_fk" FOREIGN KEY ("sale_cycle_id","unit_id") REFERENCES "public"."sale_cycles"("id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_operation_id_inventory_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_operation_id_inventory_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_unit_id_product_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_from_location_id_stock_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_to_location_id_stock_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reverses_movement_id_inventory_movements_id_fk" FOREIGN KEY ("reverses_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "movements_shipment_unit_fk" FOREIGN KEY ("shipment_item_id","unit_id") REFERENCES "public"."shipment_items"("id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "movements_return_unit_fk" FOREIGN KEY ("return_item_id","unit_id") REFERENCES "public"."return_items"("id","unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_operation_id_inventory_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_unit_id_product_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_marking_id_unit_markings_id_fk" FOREIGN KEY ("marking_id") REFERENCES "public"."unit_markings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_document_items" ADD CONSTRAINT "chz_document_items_document_id_chz_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."chz_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_document_items" ADD CONSTRAINT "chz_document_items_chz_operation_id_chz_operations_id_fk" FOREIGN KEY ("chz_operation_id") REFERENCES "public"."chz_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_document_items" ADD CONSTRAINT "chz_document_items_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_documents" ADD CONSTRAINT "chz_documents_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_documents" ADD CONSTRAINT "chz_documents_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_operations" ADD CONSTRAINT "chz_operations_marking_id_unit_markings_id_fk" FOREIGN KEY ("marking_id") REFERENCES "public"."unit_markings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_operations" ADD CONSTRAINT "chz_operations_sale_cycle_id_sale_cycles_id_fk" FOREIGN KEY ("sale_cycle_id") REFERENCES "public"."sale_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_operations" ADD CONSTRAINT "chz_operations_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_operations" ADD CONSTRAINT "chz_operations_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_operations" ADD CONSTRAINT "chz_operations_integration_operation_id_integration_operations_id_fk" FOREIGN KEY ("integration_operation_id") REFERENCES "public"."integration_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chz_operations" ADD CONSTRAINT "chz_operations_last_operation_id_inventory_operations_id_fk" FOREIGN KEY ("last_operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_marking_events" ADD CONSTRAINT "unit_marking_events_marking_id_unit_markings_id_fk" FOREIGN KEY ("marking_id") REFERENCES "public"."unit_markings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_marking_events" ADD CONSTRAINT "unit_marking_events_chz_document_item_id_chz_document_items_id_fk" FOREIGN KEY ("chz_document_item_id") REFERENCES "public"."chz_document_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_marking_events" ADD CONSTRAINT "unit_marking_events_operation_id_inventory_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."inventory_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_sources_variant_time_idx" ON "catalog_attribute_sources" USING btree ("variant_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "counterparties_external_uidx" ON "counterparties" USING btree ("external_namespace","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_binding_model_uidx" ON "product_photo_bindings" USING btree ("product_id") WHERE "product_photo_bindings"."color" IS NULL AND "product_photo_bindings"."variant_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "photo_binding_color_uidx" ON "product_photo_bindings" USING btree ("product_id","color") WHERE "product_photo_bindings"."color" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "photo_binding_variant_uidx" ON "product_photo_bindings" USING btree ("variant_id") WHERE "product_photo_bindings"."variant_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_manufacturer_article_uidx" ON "products" USING btree ("manufacturer_id","manufacturer_article","model_discriminator") WHERE "products"."manufacturer_id" IS NOT NULL AND "products"."manufacturer_article" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "products_article_idx" ON "products" USING btree ("manufacturer_article");--> statement-breakpoint
CREATE INDEX "variant_identifiers_variant_idx" ON "variant_identifiers" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "cost_layer_prices_operation_idx" ON "cost_layer_prices" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "inventory_operations_time_idx" ON "inventory_operations" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_operations_correlation_idx" ON "inventory_operations" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "product_units_position_idx" ON "product_units" USING btree ("current_location_id","variant_id","current_state");--> statement-breakpoint
CREATE INDEX "receipt_items_receipt_idx" ON "stock_receipt_items" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_markings_active_unit_uidx" ON "unit_markings" USING btree ("unit_id") WHERE "unit_markings"."retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_markings_replacement_uidx" ON "unit_markings" USING btree ("supersedes_marking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_shifts_open_user_uidx" ON "work_shifts" USING btree ("user_id") WHERE "work_shifts"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "avito_item_variant_active_uidx" ON "avito_item_variants" USING btree ("item_id","variant_id") WHERE "avito_item_variants"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_active_unit_uidx" ON "inventory_reservations" USING btree ("unit_id") WHERE "inventory_reservations"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "reservations_order_item_idx" ON "inventory_reservations" USING btree ("order_item_id","status");--> statement-breakpoint
CREATE INDEX "orders_status_time_idx" ON "orders" USING btree ("status","ordered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_cycles_active_unit_uidx" ON "sale_cycles" USING btree ("unit_id") WHERE "sale_cycles"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_items_active_cycle_uidx" ON "shipment_items" USING btree ("sale_cycle_id") WHERE "shipment_items"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shipment_items_shipment_idx" ON "shipment_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_events_entity_idx" ON "inventory_events" USING btree ("entity_type","entity_id","id");--> statement-breakpoint
CREATE INDEX "inventory_events_operation_idx" ON "inventory_events" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_unit_time_idx" ON "inventory_movements" USING btree ("unit_id","recorded_at");--> statement-breakpoint
CREATE INDEX "inventory_scans_unit_time_idx" ON "inventory_scans" USING btree ("unit_id","recorded_at");--> statement-breakpoint
CREATE INDEX "chz_operations_deadline_idx" ON "chz_operations" USING btree ("status","submission_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chz_operations_pending_marking_uidx" ON "chz_operations" USING btree ("marking_id") WHERE "chz_operations"."status" IN ('PREPARING', 'WAITING_SIGNATURE', 'SUBMITTED', 'PROCESSING', 'UNKNOWN_RESULT', 'MANUAL_ATTENTION');--> statement-breakpoint
CREATE INDEX "marking_events_latest_idx" ON "unit_marking_events" USING btree ("marking_id","observed_at","id");