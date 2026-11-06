CREATE TABLE "signer_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signer_enrollments_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "signer_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"signer_id" text NOT NULL,
	"seller_inn" text NOT NULL,
	"certificate_thumbprint" text NOT NULL,
	"certificate_expires_at" timestamp with time zone NOT NULL,
	"device_token_hash" text NOT NULL,
	"pairing_code" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"approved_at" timestamp with time zone,
	"notification_message_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signer_installations_enrollment_id_unique" UNIQUE("enrollment_id"),
	CONSTRAINT "signer_installations_signer_id_unique" UNIQUE("signer_id"),
	CONSTRAINT "signer_installations_device_token_hash_unique" UNIQUE("device_token_hash")
);
--> statement-breakpoint
ALTER TABLE "signer_enrollments" ADD CONSTRAINT "signer_enrollments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signer_installations" ADD CONSTRAINT "signer_installations_enrollment_id_signer_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."signer_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signer_installations" ADD CONSTRAINT "signer_installations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE signer_enrollments ADD CONSTRAINT signer_enrollment_hash_check CHECK(token_hash ~ '^[0-9a-f]{64}$' AND expires_at>created_at);
--> statement-breakpoint
ALTER TABLE signer_installations ADD CONSTRAINT signer_installation_identity_check CHECK(seller_inn ~ '^\d{12}$' AND device_token_hash ~ '^[0-9a-f]{64}$' AND certificate_thumbprint ~ '^[0-9A-F]{40}$' AND pairing_code ~ '^\d{6}$' AND status IN ('PENDING','ACTIVE','REJECTED','REVOKED') AND (status<>'ACTIVE' OR approved_at IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX signer_one_active ON signer_installations((true)) WHERE status='ACTIVE';
--> statement-breakpoint
CREATE FUNCTION guard_signer_installation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain signer enrollment history' USING ERRCODE='23514';END IF;
 IF (NEW.enrollment_id,NEW.owner_id,NEW.signer_id,NEW.seller_inn,NEW.certificate_thumbprint,NEW.certificate_expires_at,NEW.device_token_hash,NEW.pairing_code,NEW.created_at) IS DISTINCT FROM (OLD.enrollment_id,OLD.owner_id,OLD.signer_id,OLD.seller_inn,OLD.certificate_thumbprint,OLD.certificate_expires_at,OLD.device_token_hash,OLD.pairing_code,OLD.created_at) THEN RAISE EXCEPTION 'Signer identity is immutable' USING ERRCODE='23514';END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT((OLD.status='PENDING' AND NEW.status IN ('ACTIVE','REJECTED','REVOKED')) OR(OLD.status='ACTIVE' AND NEW.status='REVOKED')) THEN RAISE EXCEPTION 'Invalid signer transition' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER signer_installation_identity BEFORE UPDATE OR DELETE ON signer_installations FOR EACH ROW EXECUTE FUNCTION guard_signer_installation_identity();
