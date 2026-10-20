import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from './client.js';
import { createInventoryStore } from './inventory.js';
import {
  productVariants,
  users,
  products,
  variantIdentifiers,
} from './schema.js';
import { createReceiveStock } from '@avito/domain';

// Run only on an isolated, migrated database. History is append-only; drop the DB afterward.
const url =
  process.env.RUN_INVENTORY_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
const suite = url ? describe : describe.skip;
suite('scanned warehouse receipts in PostgreSQL', () => {
  const client = url ? createDatabaseClient(url) : undefined;
  const store = client ? createInventoryStore(client.db) : undefined;
  const actorId = randomUUID();
  const user = {
    id: actorId,
    telegramId: 'inventory-test',
    displayName: null,
    roles: ['OWNER'],
  };
  const protectMarking = (raw: string, identity: string) => ({
    identityHash: createHash('sha256').update(identity).digest('hex'),
    inputFingerprint: createHash('sha256').update(raw).digest('hex'),
    payloadCiphertext: 'encrypted-test-fixture',
    encryptionKeyId: 'test',
  });
  const receive = createReceiveStock({
    receive: (command) => store!.receive(command),
    protectMarking,
  });
  const raw = (serial: string, gtin = '04660430764543') =>
    `01${gtin}21${serial}\u001d91ABCD\u001d92${'A'.repeat(44)}`;
  const scan = (serial: string, requestId = randomUUID(), gtin?: string) => ({
    requestId,
    raw: raw(serial, gtin),
    scannerProfile: 'camera-gs1-v1' as const,
  });
  beforeAll(async () => {
    await client!.db
      .insert(users)
      .values({ id: actorId, telegramId: `inventory-test-${randomUUID()}` });
  });
  afterAll(async () => {
    await client?.pool.end();
  });
  it('accepts one unit, replays safely, and audits another scan without extra stock', async () => {
    const input = scan('TEST000000001');
    const first = await receive(user, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.outcome).toBe('ACCEPTED');
    expect(first.unit.state).toBe('QUARANTINE');
    const replay = await receive(user, input);
    expect(replay.ok && replay.replayed).toBe(true);
    const duplicate = await receive(user, scan('TEST000000001'));
    expect(duplicate.ok && duplicate.outcome).toBe('DUPLICATE');
    const page = await store!.list({
      search: '04660430764543',
      offset: 0,
      limit: 40,
    });
    expect(page.items[0]?.onHand).toBe(1);
    expect(page.items[0]?.available).toBe(0);
    expect(
      (
        await client!.db.execute(
          sql`SELECT * FROM inventory_movements WHERE unit_id=${first.unit.id}`,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await client!.db.execute(
          sql`SELECT * FROM inventory_scans WHERE unit_id=${first.unit.id}`,
        )
      ).rows,
    ).toHaveLength(2);
    expect(
      (await client!.db.execute(sql`SELECT * FROM cost_layer_prices`)).rows,
    ).toHaveLength(0);
  });
  it('does not reuse a request ID with different input', async () => {
    const requestId = randomUUID();
    await receive(user, scan('TEST000000002', requestId));
    expect(await receive(user, scan('TEST000000003', requestId))).toEqual({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
  it('deduplicates concurrent scans and groups different serials under one GTIN', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => receive(user, scan('TEST000000004'))),
    );
    expect(
      results.filter((r) => r.ok && r.outcome === 'ACCEPTED'),
    ).toHaveLength(1);
    await Promise.all(
      ['TEST000000005', 'TEST000000006'].map((serial) =>
        receive(user, scan(serial)),
      ),
    );
    const page = await store!.list({
      search: '04660430764543',
      offset: 0,
      limit: 40,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.onHand).toBe(5);
    expect(page.totals.onHand).toBe(5);
    expect((await store!.units(page.items[0]!.id, 0)).items).toHaveLength(5);
  });
  it('uses the existing verified model mapping for a known GTIN', async () => {
    const [model] = await client!.db
      .insert(products)
      .values({
        name: 'Джинсы модель 208-1',
        manufacturerArticle: '208-1',
        reviewStatus: 'VERIFIED',
      })
      .returning();
    const [variant] = await client!.db
      .insert(productVariants)
      .values({
        name: 'Джинсы чёрные M',
        sku: randomUUID(),
        productId: model!.id,
        sizeLabel: 'M',
        color: 'Чёрный',
        reviewStatus: 'VERIFIED',
      })
      .returning();
    await client!.db.insert(variantIdentifiers).values({
      variantId: variant!.id,
      gtin: '04660430764550',
      source: 'FILE_IMPORT',
    });
    const result = await receive(
      user,
      scan('TEST000000007', randomUUID(), '04660430764550'),
    );
    expect(result.ok && result.unit.variantId).toBe(variant!.id);
    const page = await store!.list({ search: '208-1', offset: 0, limit: 40 });
    expect(page.items[0]?.productId).toBe(model!.id);
    expect(page.items[0]?.size).toBe('M');
  });
  it('rolls back all effects when a downstream constraint fails', async () => {
    const parsed = await import('@avito/domain');
    const marking = parsed.parseClothingMarking(
      raw('TEST000000008'),
      'camera-gs1-v1',
    );
    if (!marking.ok) throw Error('fixture');
    const before = await store!.list({ search: '', offset: 0, limit: 40 });
    await expect(
      store!.receive({
        actorUserId: actorId,
        requestId: randomUUID(),
        gtin: marking.marking.gtin,
        maskedCode: marking.marking.maskedCode,
        parserProfile: marking.marking.parserProfile,
        scannerProfile: 'camera-gs1-v1',
        ...protectMarking(raw('TEST000000008'), marking.marking.identity),
        payloadCiphertext: '',
      }),
    ).rejects.toThrow();
    expect(
      (await store!.list({ search: '', offset: 0, limit: 40 })).totals,
    ).toEqual(before.totals);
  });
});
