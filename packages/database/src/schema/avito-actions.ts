import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { integrationOperations, users } from './foundation.js';
export const avitoOrderActions = pgTable(
  'avito_order_actions',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => integrationOperations.id),
    accountId: text('account_id').notNull(),
    orderId: text('order_id').notNull(),
    action: text('action').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    requestId: uuid('request_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    payloadCiphertext: text('payload_ciphertext').notNull(),
    encryptionKeyId: text('encryption_key_id').notNull(),
    identityHash: text('identity_hash').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    result: jsonb('result').$type<{ labelTaskId?: string }>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique('avito_order_actions_request_uq').on(t.actorId, t.requestId),
    index('avito_order_actions_order_idx').on(t.accountId, t.orderId),
    check(
      'avito_order_actions_name_check',
      sql`${t.action} IN ('confirm','reject','perform','receive','setTrackNumber','fixTrackNumber','acceptReturnOrder','setCNCDetails','setCourierDeliveryRange','label')`,
    ),
  ],
);
