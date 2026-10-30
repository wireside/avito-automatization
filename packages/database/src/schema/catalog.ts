import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './foundation.js';
import { entityId, recordedAt, timestamps } from './common.js';

export const dataSourceEnum = pgEnum('data_source', [
  'CHZ',
  'NATIONAL_CATALOG',
  'SUPPLIER_API',
  'EDI',
  'FILE_IMPORT',
  'MANUAL',
  'MIGRATION',
]);

export const counterparties = pgTable(
  'counterparties',
  {
    id: entityId(),
    name: text('name').notNull(),
    inn: varchar('inn', { length: 12 }),
    kpp: varchar('kpp', { length: 9 }),
    externalNamespace: text('external_namespace'),
    externalId: text('external_id'),
    isSupplier: boolean('is_supplier').default(false).notNull(),
    isManufacturer: boolean('is_manufacturer').default(false).notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('counterparties_external_uidx').on(
      t.externalNamespace,
      t.externalId,
    ),
    check(
      'counterparties_inn_check',
      sql`${t.inn} IS NULL OR ${t.inn} ~ '^([0-9]{10}|[0-9]{12})$'`,
    ),
    check(
      'counterparties_kpp_check',
      sql`${t.kpp} IS NULL OR (${t.kpp} ~ '^[0-9]{9}$' AND ${t.inn} IS NOT NULL AND length(${t.inn}) = 10)`,
    ),
  ],
);

export const classificationProfiles = pgTable(
  'classification_profiles',
  {
    id: entityId(),
    name: text('name').notNull(),
    tnved: varchar('tnved', { length: 10 }).notNull(),
    okpd2: varchar('okpd2', { length: 12 }).notNull(),
    applicability: jsonb('applicability')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    source: dataSourceEnum('source').notNull(),
    sourceReference: text('source_reference').notNull(),
    verifiedBy: uuid('verified_by').references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('classification_tnved_check', sql`${t.tnved} ~ '^[0-9]{10}$'`),
    check(
      'classification_okpd2_check',
      sql`${t.okpd2} ~ '^[0-9]{2}[.][0-9]{2}[.][0-9]{2}[.][0-9]{3}$'`,
    ),
    check(
      'classification_verifier_check',
      sql`(${t.verifiedAt} IS NULL) = (${t.verifiedBy} IS NULL)`,
    ),
  ],
);

export const products = pgTable(
  'products',
  {
    id: entityId(),
    name: text('name').notNull(),
    manufacturerId: uuid('manufacturer_id').references(() => counterparties.id),
    brand: text('brand'),
    manufacturerArticle: text('manufacturer_article'),
    modelDiscriminator: text('model_discriminator').default('').notNull(),
    description: text('description'),
    classificationProfileId: uuid('classification_profile_id').references(
      () => classificationProfiles.id,
    ),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('products_manufacturer_article_uidx')
      .on(t.manufacturerId, t.manufacturerArticle, t.modelDiscriminator)
      .where(
        sql`${t.manufacturerId} IS NOT NULL AND ${t.manufacturerArticle} IS NOT NULL`,
      ),
    index('products_article_idx').on(t.manufacturerArticle),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: entityId(),
    productId: uuid('product_id').references(() => products.id),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    color: text('color'),
    sizeLabel: text('size_label'),
    sizeSystem: text('size_system'),
    heightLabel: text('height_label'),
    materialComposition: text('material_composition'),
    attributes: jsonb('attributes')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    classificationProfileId: uuid('classification_profile_id').references(
      () => classificationProfiles.id,
    ),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index('product_variants_product_idx').on(t.productId)],
);

export const variantIdentifiers = pgTable(
  'variant_identifiers',
  {
    id: entityId(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    gtin: varchar('gtin', { length: 14 }).notNull().unique(),
    source: dataSourceEnum('source').notNull(),
    sourceReference: text('source_reference'),
    ...timestamps(),
  },
  (t) => [
    unique('variant_identifiers_id_variant_uq').on(t.id, t.variantId),
    check('variant_identifiers_gtin_check', sql`${t.gtin} ~ '^[0-9]{14}$'`),
    index('variant_identifiers_variant_idx').on(t.variantId),
  ],
);

// Append-only evidence. attributes must be catalog data, never raw CIS or credentials.
export const catalogAttributeSources = pgTable(
  'catalog_attribute_sources',
  {
    id: entityId(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id),
    source: dataSourceEnum('source').notNull(),
    sourceReference: text('source_reference').notNull(),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    recordedAt: recordedAt(),
    recordedBy: uuid('recorded_by').references(() => users.id),
  },
  (t) => [
    index('catalog_sources_variant_time_idx').on(t.variantId, t.recordedAt),
  ],
);

export const complianceDocuments = pgTable(
  'compliance_documents',
  {
    id: entityId(),
    kind: text('kind').notNull(),
    number: text('number').notNull(),
    registryUrl: text('registry_url'),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    source: dataSourceEnum('source').notNull(),
    sourceReference: text('source_reference').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    unique('compliance_kind_number_uq').on(t.kind, t.number),
    check(
      'compliance_dates_check',
      sql`${t.validUntil} IS NULL OR ${t.validFrom} IS NULL OR ${t.validUntil} >= ${t.validFrom}`,
    ),
  ],
);

export const productComplianceDocuments = pgTable(
  'product_compliance_documents',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    documentId: uuid('document_id')
      .notNull()
      .references(() => complianceDocuments.id),
  },
  (t) => [primaryKey({ columns: [t.productId, t.documentId] })],
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: entityId(),
    storageKey: text('storage_key').notNull().unique(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check(
      'media_dimensions_check',
      sql`${t.byteSize} > 0 AND ${t.width} > 0 AND ${t.height} > 0`,
    ),
    check('media_hash_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

// A new revision gets a new row. Published listings retain the old revision.
export const photoGroups = pgTable(
  'photo_groups',
  {
    id: entityId(),
    groupKey: uuid('group_key').defaultRandom().notNull(),
    revision: integer('revision').default(1).notNull(),
    name: text('name').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('photo_groups_revision_uq').on(t.groupKey, t.revision),
    check('photo_revision_check', sql`${t.revision} > 0`),
  ],
);

export const photoGroupItems = pgTable(
  'photo_group_items',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => photoGroups.id),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.position] }),
    unique('photo_group_asset_uq').on(t.groupId, t.assetId),
    check('photo_position_check', sql`${t.position} >= 0`),
  ],
);

export const productPhotoBindings = pgTable(
  'product_photo_bindings',
  {
    id: entityId(),
    productId: uuid('product_id').references(() => products.id),
    variantId: uuid('variant_id').references(() => productVariants.id),
    color: text('color'),
    groupId: uuid('group_id')
      .notNull()
      .references(() => photoGroups.id),
    ...timestamps(),
  },
  (t) => [
    check(
      'photo_binding_target_check',
      sql`(${t.productId} IS NOT NULL AND ${t.variantId} IS NULL) OR (${t.productId} IS NULL AND ${t.variantId} IS NOT NULL AND ${t.color} IS NULL)`,
    ),
    uniqueIndex('photo_binding_model_uidx')
      .on(t.productId)
      .where(sql`${t.color} IS NULL AND ${t.variantId} IS NULL`),
    uniqueIndex('photo_binding_color_uidx')
      .on(t.productId, t.color)
      .where(sql`${t.color} IS NOT NULL`),
    uniqueIndex('photo_binding_variant_uidx')
      .on(t.variantId)
      .where(sql`${t.variantId} IS NOT NULL`),
  ],
);
