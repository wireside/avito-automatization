import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { grantOwnerAccess, findActiveUserWithRoles } from './users.js';
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
    // Audit history and its users stay in the disposable test database.
    // Deleting audit records would violate the append-only invariant.
    await client.pool.end();
  });

  it('grants explicit owner access repeatably without duplicate roles', async () => {
    if (!client) return;
    const telegramId = String(
      8_000_000_000 + Math.floor(Math.random() * 1_000_000),
    );
    await grantOwnerAccess(client.db, telegramId, randomUUID());
    const user = await findActiveUserWithRoles(client.db, telegramId);
    expect(user?.roles).toEqual(['OWNER']);
    await grantOwnerAccess(client.db, telegramId, randomUUID());
    expect(
      (await findActiveUserWithRoles(client.db, telegramId))?.roles,
    ).toEqual(['OWNER']);
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
