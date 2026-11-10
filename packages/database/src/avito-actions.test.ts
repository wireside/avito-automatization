import { randomUUID, createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabaseClient } from './client.js';
import { createAvitoActionStore } from './avito-actions.js';
import {
  claimIntegrationOperation,
  failIntegrationOperation,
  completeIntegrationOperation,
} from './operations.js';
const url =
  process.env.RUN_MARKING_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
(url ? describe : describe.skip)('durable seller actions in PostgreSQL', () => {
  const db = createDatabaseClient(url ?? 'postgresql://unused');
  const actor = randomUUID(),
    account = 'account-' + randomUUID();
  const encrypted = new Map<string, string>();
  const protection = {
    encrypt: (raw: string, identity: string) => {
      const key = randomUUID();
      encrypted.set(key, raw);
      return {
        payloadCiphertext: key,
        encryptionKeyId: 'test',
        identityHash: createHash('sha256').update(identity).digest('hex'),
        inputFingerprint: '',
      };
    },
    decrypt: (key: string) => encrypted.get(key)!,
  };
  const store = createAvitoActionStore(db.db, protection, account);
  beforeAll(async () => {
    await db.db.execute(
      sql`INSERT INTO users(id,telegram_id) VALUES(${actor},${'actions-' + actor})`,
    );
  });
  afterAll(() => db.pool.end());
  it('atomically inserts an intent and job, handles concurrent replay, and rejects changed body', async () => {
    const command = {
      requestId: randomUUID(),
      action: 'setTrackNumber' as const,
      data: { trackingNumber: 'PRIVATE-TRACK' },
    };
    const results = await Promise.all([
      store.enqueue('501', command, actor),
      store.enqueue('501', command, actor),
    ]);
    expect(results[0].operationId).toBe(results[1].operationId);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    await expect(
      store.enqueue(
        '501',
        { ...command, data: { trackingNumber: 'changed' } },
        actor,
      ),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    const work = await store.load(results[0].operationId);
    expect(work.command).toEqual(command);
    expect(work.started).toBe(false);
    const row = (
      await db.db.execute(
        sql`SELECT o.payload,a.payload_ciphertext FROM integration_operations o JOIN avito_order_actions a ON a.id=o.id WHERE o.id=${work.id}`,
      )
    ).rows[0];
    expect(JSON.stringify(row)).not.toContain('PRIVATE-TRACK');
  });
  it('serializes competing order actions and keeps an uncertain write blocked until readback', async () => {
    const a = { requestId: randomUUID(), action: 'confirm' as const, data: {} };
    const results = await Promise.allSettled([
      store.enqueue('502', a, actor),
      store.enqueue('502', { ...a, requestId: randomUUID() }, actor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((r) => r.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw Error('missing winner');
    const id = winner.value.operationId;
    const first = await claimIntegrationOperation(db.db, id);
    await store.start(id);
    await failIntegrationOperation(db.db, {
      operationId: id,
      attemptNumber: first!.attemptCount,
      errorCode: 'AVITO_ACTION_RESULT_UNKNOWN',
      errorClass: 'TERMINAL',
    });
    await expect(
      store.enqueue('502', { ...a, requestId: randomUUID() }, actor),
    ).rejects.toThrow('ORDER_ACTION_PENDING');
    await store.reconcile(id, '502');
    expect((await store.load(id)).started).toBe(true);
    const second = await claimIntegrationOperation(db.db, id);
    await store.finish(id, {});
    await completeIntegrationOperation(db.db, id, second!.attemptCount);
    expect((await store.list('502'))[0]).toMatchObject({ status: 'SUCCEEDED' });
    await expect(
      store.enqueue(
        '502',
        { requestId: randomUUID(), action: 'reject', data: {} },
        actor,
      ),
    ).resolves.toMatchObject({ replayed: false });
  });
  it('preserves request identity and the first completed provider receipt', async () => {
    const { operationId: id } = await store.enqueue(
      '504',
      { requestId: randomUUID(), action: 'confirm', data: {} },
      actor,
    );
    await expect(
      db.db.execute(
        sql`UPDATE avito_order_actions SET action='reject' WHERE id=${id}`,
      ),
    ).rejects.toThrow();
    await store.finish(id, {});
    await expect(
      db.db.execute(
        sql`UPDATE avito_order_actions SET result='{"labelTaskId":"changed"}'::jsonb WHERE id=${id}`,
      ),
    ).rejects.toThrow();
    await expect(
      db.db.execute(sql`DELETE FROM avito_order_actions WHERE id=${id}`),
    ).rejects.toThrow();
  });
  it('cannot read or reconcile across account and order boundaries', async () => {
    const cmd = {
      requestId: randomUUID(),
      action: 'confirm' as const,
      data: {},
    };
    const queued = await store.enqueue('503', cmd, actor);
    const other = createAvitoActionStore(db.db, protection, 'other');
    await expect(other.load(queued.operationId)).rejects.toThrow(
      'ORDER_NOT_FOUND',
    );
    await expect(store.reconcile(queued.operationId, 'other')).rejects.toThrow(
      'ORDER_ACTION_UNAVAILABLE',
    );
  });
});
