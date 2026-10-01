CREATE TYPE "public"."integration_attempt_outcome" AS ENUM('RUNNING', 'SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE');--> statement-breakpoint
CREATE TYPE "public"."integration_operation_status" AS ENUM('PENDING', 'RUNNING', 'RETRY_SCHEDULED', 'SUCCEEDED', 'MANUAL_ATTENTION', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."role_name" AS ENUM('OWNER', 'ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'VIEWER');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_type" varchar(80) NOT NULL,
	"actor_id" varchar(255),
	"action" varchar(160) NOT NULL,
	"entity_type" varchar(120) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"reason" text,
	"source" varchar(120) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" "integration_attempt_outcome" DEFAULT 'RUNNING' NOT NULL,
	"provider_request_id" varchar(255),
	"response_metadata" jsonb,
	"error_code" varchar(120),
	"error_class" varchar(120),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integration_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_type" varchar(120) NOT NULL,
	"idempotency_key" varchar(500) NOT NULL,
	"aggregate_type" varchar(120) NOT NULL,
	"aggregate_id" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "integration_operation_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" varchar(120),
	"correlation_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_operations_attempts_check" CHECK ("integration_operations"."attempt_count" >= 0 AND "integration_operations"."max_attempts" BETWEEN 1 AND 20 AND "integration_operations"."attempt_count" <= "integration_operations"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" "role_name" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
INSERT INTO "roles" ("name") VALUES
	('OWNER'),
	('ADMIN'),
	('WAREHOUSE'),
	('ACCOUNTANT'),
	('VIEWER');
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" text NOT NULL,
	"display_name" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_attempts" ADD CONSTRAINT "integration_attempts_operation_id_integration_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."integration_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_correlation_idx" ON "audit_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_attempts_operation_number_uidx" ON "integration_attempts" USING btree ("operation_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_operations_idempotency_key_uidx" ON "integration_operations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_operations_recovery_idx" ON "integration_operations" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "integration_operations_aggregate_idx" ON "integration_operations" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_uidx" ON "users" USING btree ("telegram_id");
