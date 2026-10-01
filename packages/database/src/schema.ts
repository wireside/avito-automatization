import { sql } from 'drizzle-orm';
import {
  bigint,
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
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const roleNameEnum = pgEnum('role_name', [
  'OWNER',
  'ADMIN',
  'WAREHOUSE',
  'ACCOUNTANT',
  'VIEWER',
]);

export const integrationOperationStatusEnum = pgEnum(
  'integration_operation_status',
  [
    'PENDING',
    'RUNNING',
    'RETRY_SCHEDULED',
    'SUCCEEDED',
    'MANUAL_ATTENTION',
    'CANCELLED',
  ],
);

export const integrationAttemptOutcomeEnum = pgEnum(
  'integration_attempt_outcome',
  ['RUNNING', 'SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE'],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    telegramId: text('telegram_id').notNull(),
    displayName: varchar('display_name', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex('users_telegram_id_uidx').on(table.telegramId)],
);

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: roleNameEnum('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export const integrationOperations = pgTable(
  'integration_operations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    operationType: varchar('operation_type', { length: 120 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 500 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 120 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 255 }).notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: integrationOperationStatusEnum('status')
      .notNull()
      .default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 120 }),
    correlationId: uuid('correlation_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('integration_operations_idempotency_key_uidx').on(
      table.idempotencyKey,
    ),
    index('integration_operations_recovery_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
    index('integration_operations_aggregate_idx').on(
      table.aggregateType,
      table.aggregateId,
    ),
    check(
      'integration_operations_attempts_check',
      sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 20 AND ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
  ],
);

export const integrationAttempts = pgTable(
  'integration_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => integrationOperations.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    outcome: integrationAttemptOutcomeEnum('outcome')
      .notNull()
      .default('RUNNING'),
    providerRequestId: varchar('provider_request_id', { length: 255 }),
    responseMetadata:
      jsonb('response_metadata').$type<Record<string, unknown>>(),
    errorCode: varchar('error_code', { length: 120 }),
    errorClass: varchar('error_class', { length: 120 }),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('integration_attempts_operation_number_uidx').on(
      table.operationId,
      table.attemptNumber,
    ),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'bigint' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    actorType: varchar('actor_type', { length: 80 }).notNull(),
    actorId: varchar('actor_id', { length: 255 }),
    action: varchar('action', { length: 160 }).notNull(),
    entityType: varchar('entity_type', { length: 120 }).notNull(),
    entityId: varchar('entity_id', { length: 255 }).notNull(),
    reason: text('reason'),
    source: varchar('source', { length: 120 }).notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    index('audit_log_correlation_idx').on(table.correlationId),
    index('audit_log_created_at_idx').on(table.createdAt),
  ],
);
