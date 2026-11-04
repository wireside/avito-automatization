import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabaseClient } from './client.js';
import {
  createIntegrationOperation,
  claimIntegrationOperation,
  completeIntegrationOperation,
  recoverAbandonedOperations,
} from './operations.js';
const url =
  process.env.RUN_MARKING_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
(url ? it : it.skip)(
  'recovers an abandoned attempt, keeps history and fences stale completion',
  async () => {
    const client = createDatabaseClient(url!);
    try {
      const operation = await createIntegrationOperation(client.db, {
        operationType: 'pipeline.check',
        idempotencyKey: randomUUID(),
        aggregateType: 'unit',
        aggregateId: randomUUID(),
        correlationId: randomUUID(),
      });
      const first = await claimIntegrationOperation(client.db, operation.id);
      expect(first?.attemptCount).toBe(1);
      await client.db.execute(
        sql`UPDATE integration_operations SET started_at=now()-interval '6 minutes' WHERE id=${operation.id}`,
      );
      await recoverAbandonedOperations(client.db);
      const second = await claimIntegrationOperation(client.db, operation.id);
      expect(second?.attemptCount).toBe(2);
      await completeIntegrationOperation(client.db, operation.id, 1);
      expect(
        (
          await client.db.execute(
            sql`SELECT status FROM integration_operations WHERE id=${operation.id}`,
          )
        ).rows[0]!.status,
      ).toBe('RUNNING');
      await completeIntegrationOperation(client.db, operation.id, 2);
      expect(
        (
          await client.db.execute(
            sql`SELECT count(*)::int AS n FROM integration_attempts WHERE operation_id=${operation.id}`,
          )
        ).rows[0]!.n,
      ).toBe(2);
    } finally {
      await client.pool.end();
    }
  },
);
