import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
import {
  createDatabaseClient,
  createIntegrationOperation,
} from '@avito/database';
import { createAvitoOrderLane } from './avito-order-lane.js';
const url =
  process.env.RUN_MARKING_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
(url ? it : it.skip)(
  'uses one session lane across actions and marking jobs and releases it after failure',
  async () => {
    const db = createDatabaseClient(url!);
    const actor = randomUUID(),
      account = 'lane-' + randomUUID(),
      orderId = '50000000000000099';
    try {
      await db.pool.query('INSERT INTO users(id,telegram_id) VALUES($1,$2)', [
        actor,
        'lane-' + actor,
      ]);
      const job = await createIntegrationOperation(db.db, {
        operationType: 'avito.order-action',
        idempotencyKey: randomUUID(),
        aggregateType: 'avito-order',
        aggregateId: orderId,
        correlationId: randomUUID(),
      });
      await db.pool.query(
        `INSERT INTO avito_order_actions(id,account_id,order_id,action,actor_id,request_id,fingerprint,payload_ciphertext,encryption_key_id,identity_hash) VALUES($1,$2,$3,'confirm',$4,$5,'fixture','encrypted','test','identity')`,
        [job.id, account, orderId, actor, randomUUID()],
      );
      const lane = createAvitoOrderLane(db);
      let release!: () => void, entered!: () => void;
      const blocked = new Promise<void>((resolve) => (release = resolve)),
        started = new Promise<void>((resolve) => (entered = resolve));
      const running = lane(job.id, async () => {
        entered();
        await blocked;
      });
      await started;
      const competitor = await db.pool.connect();
      try {
        const lock = await competitor.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1,2)) AS locked',
          ['avito-order:' + account + ':' + orderId],
        );
        expect(lock.rows[0]!.locked).toBe(false);
        release();
        await running;
        const after = await competitor.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1,2)) AS locked',
          ['avito-order:' + account + ':' + orderId],
        );
        expect(after.rows[0]!.locked).toBe(true);
        await competitor.query(
          'SELECT pg_advisory_unlock(hashtextextended($1,2))',
          ['avito-order:' + account + ':' + orderId],
        );
      } finally {
        release();
        competitor.release();
      }
      await expect(
        lane(job.id, () => Promise.reject(new Error('controlled failure'))),
      ).rejects.toThrow('controlled failure');
      await expect(
        lane(job.id, () => Promise.resolve()),
      ).resolves.toBeUndefined();
    } finally {
      await db.pool.end();
    }
  },
);
