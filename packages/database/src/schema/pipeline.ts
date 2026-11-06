import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  unique,
  integer,
} from 'drizzle-orm/pg-core';
import { chzDocuments } from './marking.js';
import { users } from './foundation.js';
import { productUnits, warehouses } from './stock.js';
import { entityId } from './common.js';
export const markingPipelineSettings = pgTable('marking_pipeline_settings', {
  warehouseId: uuid('warehouse_id')
    .primaryKey()
    .references(() => warehouses.id),
  sellerInn: text('seller_inn').notNull(),
  fiasId: uuid('fias_id').notNull(),
  address: text('address').notNull(),
  fiscalEvidenceReference: text('fiscal_evidence_reference').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const markingBusinessDays = pgTable('marking_business_days', {
  date: text('date').primaryKey(),
  working: boolean('working').notNull(),
});
export const markingCommandResults = pgTable(
  'marking_command_results',
  {
    id: entityId(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    requestId: uuid('request_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique('marking_commands_actor_request_uq').on(t.actorId, t.requestId),
  ],
);
export const markingSupplyEvidence = pgTable('marking_supply_evidence', {
  unitId: uuid('unit_id')
    .primaryKey()
    .references(() => productUnits.id),
  documentNumber: text('document_number').notNull(),
  documentDate: text('document_date').notNull(),
  supplierInn: text('supplier_inn').notNull(),
  evidenceReference: text('evidence_reference').notNull(),
  providerDocumentId: text('provider_document_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
});
export const markingIssues = pgTable('marking_issues', {
  id: entityId(),
  key: text('key').notNull().unique(),
  code: text('code').notNull(),
  entityId: uuid('entity_id').notNull(),
  details: jsonb('details')
    .$type<Record<string, unknown>>()
    .default({})
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});
export const markingDocumentArtifacts = pgTable('marking_document_artifacts', {
  documentId: uuid('document_id')
    .primaryKey()
    .references(() => chzDocuments.id),
  documentType: text('document_type').notNull(),
  payloadCiphertext: text('payload_ciphertext').notNull(),
  encryptionKeyId: text('encryption_key_id').notNull(),
  identityHash: text('identity_hash').notNull(),
  payloadHash: text('payload_hash').notNull(),
  byteLength: integer('byte_length').notNull(),
});

export const signerJobs = pgTable('signer_jobs', {
  id: entityId(),
  documentId: uuid('document_id')
    .unique()
    .references(() => chzDocuments.id),
  purpose: text('purpose').notNull(),
  documentType: text('document_type').notNull(),
  sellerInn: text('seller_inn').notNull(),
  authUuid: text('auth_uuid'),
  payloadCiphertext: text('payload_ciphertext').notNull(),
  encryptionKeyId: text('encryption_key_id').notNull(),
  identityHash: text('identity_hash').notNull(),
  payloadHash: text('payload_hash').notNull(),
  status: text('status').default('PENDING').notNull(),
  signerId: text('signer_id'),
  leaseId: uuid('lease_id'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  signatureCiphertext: text('signature_ciphertext'),
  signatureKeyId: text('signature_key_id'),
  signatureIdentityHash: text('signature_identity_hash'),
  signatureHash: text('signature_hash'),
  certificateThumbprint: text('certificate_thumbprint'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const signerDevices = pgTable('signer_devices', {
  signerId: text('signer_id').primaryKey(),
  certificateThumbprint: text('certificate_thumbprint').notNull(),
  certificateExpiresAt: timestamp('certificate_expires_at', {
    withTimezone: true,
  }).notNull(),
  ready: boolean('ready').notNull(),
  errorCode: text('error_code'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
});
export const chzSessions = pgTable('chz_sessions', {
  sellerInn: text('seller_inn').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  keyId: text('key_id').notNull(),
  identityHash: text('identity_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const markingProviderReceipts = pgTable('marking_provider_receipts', {
  id: entityId(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => chzDocuments.id),
  payloadCiphertext: text('payload_ciphertext').notNull(),
  encryptionKeyId: text('encryption_key_id').notNull(),
  identityHash: text('identity_hash').notNull(),
  payloadHash: text('payload_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const signerEnrollments = pgTable('signer_enrollments', {
  id: entityId(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const signerInstallations = pgTable('signer_installations', {
  id: entityId(),
  enrollmentId: uuid('enrollment_id')
    .notNull()
    .unique()
    .references(() => signerEnrollments.id),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  signerId: text('signer_id').notNull().unique(),
  sellerInn: text('seller_inn').notNull(),
  certificateThumbprint: text('certificate_thumbprint').notNull(),
  certificateExpiresAt: timestamp('certificate_expires_at', {
    withTimezone: true,
  }).notNull(),
  deviceTokenHash: text('device_token_hash').notNull().unique(),
  pairingCode: text('pairing_code').notNull(),
  status: text('status').notNull().default('PENDING'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  notificationMessageId: integer('notification_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
