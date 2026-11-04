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
/** Deliberately separate from production legal observations: test provider's durable state. */
export const markingSimulationUnits = pgTable('marking_simulation_units', {
  unitId: uuid('unit_id')
    .primaryKey()
    .references(() => productUnits.id),
  providerState: text('provider_state').notNull(),
  ownerInn: text('owner_inn').notNull(),
  outcome: text('outcome').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const markingSupplyEvidence = pgTable('marking_supply_evidence', {
  unitId: uuid('unit_id')
    .primaryKey()
    .references(() => productUnits.id),
  documentNumber: text('document_number').notNull(),
  documentDate: text('document_date').notNull(),
  supplierInn: text('supplier_inn').notNull(),
  evidenceReference: text('evidence_reference').notNull(),
  simulated: boolean('simulated').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
});
export const markingSimulationDocuments = pgTable(
  'marking_simulation_documents',
  {
    documentId: uuid('document_id').primaryKey(),
    externalId: uuid('external_id').defaultRandom().notNull(),
    payloadHash: text('payload_hash').notNull(),
    items: jsonb('items').$type<Record<string, string>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);
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

export const markingSigningTasks = pgTable('marking_signing_tasks', {
  id: entityId(),
  documentId: uuid('document_id')
    .notNull()
    .unique()
    .references(() => chzDocuments.id),
  sellerInn: text('seller_inn').notNull(),
  simulated: boolean('simulated').notNull(),
  status: text('status').default('PENDING').notNull(),
  signerId: text('signer_id'),
  leaseId: uuid('lease_id'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  signatureCiphertext: text('signature_ciphertext'),
  signatureKeyId: text('signature_key_id'),
  signatureIdentityHash: text('signature_identity_hash'),
  signatureHash: text('signature_hash'),
  verifiedPayloadHash: text('verified_payload_hash'),
  verificationSource: text('verification_source'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
