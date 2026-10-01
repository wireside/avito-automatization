import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDatabaseClient } from './client.js';
import { createIntegrationOperation } from './operations.js';
import { integrationOperations } from './schema.js';

const databaseUrl =
  process.env.RUN_DATABASE_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
const suite = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;
const createdIds: string[] = [];

suite('durable integration operations', () => {
  afterAll(async () => {
    if (!client) return;
    for (const id of createdIds) {
      await client.db
        .delete(integrationOperations)
        .where(eq(integrationOperations.id, id));
    }
    await client.pool.end();
  });

  it('deduplicates operations by stable idempotency key', async () => {
    if (!client) return;
    const correlationId = randomUUID();
    const input = {
      operationType: 'system.noop',
      idempotencyKey: `test:${randomUUID()}`,
      aggregateType: 'system',
      aggregateId: 'test',
      correlationId,
    };
    const first = await createIntegrationOperation(client.db, input);
    createdIds.push(first.id);
    const second = await createIntegrationOperation(client.db, input);
    expect(second.id).toBe(first.id);
  });
});
