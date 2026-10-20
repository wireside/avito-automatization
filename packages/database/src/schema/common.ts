import { timestamp, uuid } from 'drizzle-orm/pg-core';

export const entityId = () => uuid('id').defaultRandom().primaryKey();
export const recordedAt = () =>
  timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull();
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
