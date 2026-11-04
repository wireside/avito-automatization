CREATE TABLE "marking_document_artifacts" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"document_type" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"identity_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"byte_length" integer NOT NULL
);
