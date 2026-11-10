CREATE TABLE "avito_order_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"order_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"identity_hash" text NOT NULL,
	"started_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avito_order_actions_request_uq" UNIQUE("actor_id","request_id"),
	CONSTRAINT "avito_order_actions_name_check" CHECK ("avito_order_actions"."action" IN ('confirm','reject','perform','receive','setTrackNumber','fixTrackNumber','acceptReturnOrder','setCNCDetails','setCourierDeliveryRange','label'))
);
--> statement-breakpoint
ALTER TABLE "avito_order_actions" ADD CONSTRAINT "avito_order_actions_id_integration_operations_id_fk" FOREIGN KEY ("id") REFERENCES "public"."integration_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avito_order_actions" ADD CONSTRAINT "avito_order_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avito_order_actions_order_idx" ON "avito_order_actions" USING btree ("account_id","order_id");
--> statement-breakpoint
CREATE FUNCTION guard_avito_action_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain Avito action evidence' USING ERRCODE='23514';END IF;
 IF (NEW.id,NEW.account_id,NEW.order_id,NEW.action,NEW.actor_id,NEW.request_id,NEW.fingerprint,NEW.payload_ciphertext,NEW.encryption_key_id,NEW.identity_hash,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.account_id,OLD.order_id,OLD.action,OLD.actor_id,OLD.request_id,OLD.fingerprint,OLD.payload_ciphertext,OLD.encryption_key_id,OLD.identity_hash,OLD.created_at) THEN RAISE EXCEPTION 'Avito action identity is immutable' USING ERRCODE='23514';END IF;
 IF OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result THEN RAISE EXCEPTION 'Avito result is immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER avito_action_identity BEFORE UPDATE OR DELETE ON avito_order_actions FOR EACH ROW EXECUTE FUNCTION guard_avito_action_identity();
