import { randomUUID, createHash } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabaseClient } from './client.js';
import { createInventoryStore } from './inventory.js';
import {
  productVariants,
  users,
  products,
  variantIdentifiers,
} from './schema.js';
import {
  createReceiveStock,
  type ReceiptCatalog,
  type CatalogLookupResult,
} from '@avito/domain';
const url =
  process.env.RUN_INVENTORY_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
const suite = url ? describe : describe.skip;
suite('catalog-backed warehouse receipt without review', () => {
  const client = url ? createDatabaseClient(url) : undefined;
  const store = client ? createInventoryStore(client.db) : undefined;
  const actorId = randomUUID();
  const user = {
    id: actorId,
    telegramId: 'test',
    displayName: null,
    roles: ['OWNER'],
  };
  const protectMarking = (raw: string, identity: string) => ({
    identityHash: createHash('sha256').update(identity).digest('hex'),
    inputFingerprint: createHash('sha256').update(raw).digest('hex'),
    payloadCiphertext: 'encrypted-test-fixture',
    encryptionKeyId: 'test',
  });
  const catalog = (gtin: string): ReceiptCatalog => ({
    gtin,
    sourceReference: 'national-catalog:fixture-' + gtin,
    observedAt: '2026-10-29T12:00:00.000Z',
    name: 'Брюки ZZ-8 белый XL',
    sourceName: 'Брюки арт. ZZ-8 белые XL',
    article: 'ZZ-8',
    color: 'белый',
    size: 'XL',
    sizeSystem: 'ЕВРОПА',
    materialComposition: 'Хлопок 100%',
    attributes: [],
  });
  const lookupCatalog = vi
    .fn<(gtin: string) => Promise<CatalogLookupResult>>()
    .mockImplementation((gtin) =>
      Promise.resolve({ status: 'FOUND', product: catalog(gtin) }),
    );
  const receive = createReceiveStock({
    receive: (command) => store!.receive(command),
    needsCatalogLookup: (gtin) => store!.needsCatalogLookup(gtin),
    protectMarking,
    lookupCatalog,
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
      .values({ id: actorId, telegramId: 'inventory-test-' + randomUUID() });
  });
  afterAll(async () => {
    await client?.pool.end();
  });
  it('commits immediately to available stock without legal observations, manual approval or purchase price', async () => {
    const input = scan('TEST000000001');
    const first = await receive(user, input);
    expect(first.ok).toBe(true);
    if (!first.ok) throw Error('receipt');
    expect(first.unit).toMatchObject({
      state: 'AVAILABLE',
      location: 'Основное хранение',
      name: catalog('04660430764543').name,
    });
    expect(first.unit).not.toHaveProperty('catalogStatus');
    const page = await store!.list({
      search: '04660430764543',
      offset: 0,
      limit: 40,
    });
    expect(page.items[0]).toMatchObject({
      onHand: 1,
      available: 1,
      quarantine: 0,
    });
    expect(page.items[0]).not.toHaveProperty('reviewStatus');
    expect(await receive(user, input)).toMatchObject({
      ok: true,
      replayed: true,
      outcome: 'ACCEPTED',
    });
    expect(await receive(user, scan('TEST000000001'))).toMatchObject({
      ok: true,
      outcome: 'DUPLICATE',
    });
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
      (await client!.db.execute(sql`SELECT * FROM unit_marking_events`)).rows,
    ).toHaveLength(0);
    expect(
      (await client!.db.execute(sql`SELECT * FROM cost_layer_prices`)).rows,
    ).toHaveLength(0);
  });
  it('retains request conflict and concurrent scan deduplication', async () => {
    const requestId = randomUUID();
    await receive(user, scan('TEST000000002', requestId));
    expect(await receive(user, scan('TEST000000003', requestId))).toEqual({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => receive(user, scan('TEST000000004'))),
    );
    expect(
      results.filter((v) => v.ok && v.outcome === 'ACCEPTED'),
    ).toHaveLength(1);
    await Promise.all(
      ['TEST000000005', 'TEST000000006'].map((value) =>
        receive(user, scan(value)),
      ),
    );
    const page = await store!.list({
      search: '04660430764543',
      offset: 0,
      limit: 40,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      onHand: 5,
      available: 5,
      quarantine: 0,
    });
  });
  it('caches catalog evidence and preserves manually mapped model/size/name', async () => {
    const [model] = await client!.db
      .insert(products)
      .values({ name: 'Джинсы 208-1', manufacturerArticle: '208-1' })
      .returning();
    const [variant] = await client!.db
      .insert(productVariants)
      .values({
        name: 'Джинсы чёрные M',
        sku: randomUUID(),
        productId: model!.id,
        sizeLabel: 'M',
        color: 'Чёрный',
      })
      .returning();
    await client!.db.insert(variantIdentifiers).values({
      variantId: variant!.id,
      gtin: '04660430764550',
      source: 'FILE_IMPORT',
    });
    expect(await store!.needsCatalogLookup('04660430764550')).toBe(true);
    const result = await receive(
      user,
      scan('TEST000000007', randomUUID(), '04660430764550'),
    );
    expect(result).toMatchObject({
      ok: true,
      unit: {
        variantId: variant!.id,
        name: 'Джинсы чёрные M',
        size: 'M',
        article: '208-1',
        state: 'AVAILABLE',
      },
    });
    expect(await store!.needsCatalogLookup('04660430764550')).toBe(false);
  });
  it('never creates placeholder stock on missing, unavailable, unconfigured or ambiguous catalog data', async () => {
    const gtin = '04660430764635';
    for (const status of [
      'NOT_FOUND',
      'UNAVAILABLE',
      'NOT_CONFIGURED',
      'AMBIGUOUS',
    ] as const) {
      const scenario = createReceiveStock({
        receive: (command) => store!.receive(command),
        protectMarking,
        lookupCatalog: () => Promise.resolve({ status }),
      });
      const expected =
        status === 'NOT_FOUND'
          ? 'CATALOG_NOT_FOUND'
          : status === 'UNAVAILABLE'
            ? 'CATALOG_UNAVAILABLE'
            : status === 'NOT_CONFIGURED'
              ? 'CATALOG_NOT_CONFIGURED'
              : 'CATALOG_AMBIGUOUS';
      expect(
        await scenario(user, scan('TEST000000008', randomUUID(), gtin)),
      ).toEqual({ ok: false, code: expected });
    }
    expect(
      (await store!.list({ search: gtin, offset: 0, limit: 40 })).items,
    ).toEqual([]);
    expect(
      await client!.db
        .select()
        .from(variantIdentifiers)
        .where(eq(variantIdentifiers.gtin, gtin)),
    ).toHaveLength(0);
  });
  it('rolls back catalog data, unit and receipt when downstream writing fails', async () => {
    const gtin = '04660430764611';
    const before = await store!.list({ search: '', offset: 0, limit: 40 });
    const failing = createReceiveStock({
      receive: (command) => store!.receive(command),
      lookupCatalog: () =>
        Promise.resolve({ status: 'FOUND', product: catalog(gtin) }),
      protectMarking: (value, identity) => ({
        ...protectMarking(value, identity),
        payloadCiphertext: '',
      }),
    });
    await expect(
      failing(user, scan('TEST000000009', randomUUID(), gtin)),
    ).rejects.toThrow();
    expect(
      (await store!.list({ search: '', offset: 0, limit: 40 })).totals,
    ).toEqual(before.totals);
    expect(await store!.needsCatalogLookup(gtin)).toBe(true);
    expect(
      (await store!.list({ search: gtin, offset: 0, limit: 40 })).items,
    ).toHaveLength(0);
  });
  it('requires catalog evidence even if the storage adapter is called directly', async () => {
    const gtin = '04660430764635';
    const identity = '01' + gtin + '21TEST000000010';
    expect(
      await store!.receive({
        actorUserId: actorId,
        requestId: randomUUID(),
        gtin,
        maskedCode: 'masked',
        parserProfile: 'test',
        scannerProfile: 'camera-gs1-v1',
        ...protectMarking(raw('TEST000000010', gtin), identity),
      }),
    ).toEqual({ ok: false, code: 'CATALOG_NOT_FOUND' });
  });
  it('does not turn missing nonessential catalog attributes into a pending state', async () => {
    const gtin = '04660430764604';
    const scenario = createReceiveStock({
      receive: (command) => store!.receive(command),
      protectMarking,
      lookupCatalog: () =>
        Promise.resolve({
          status: 'FOUND',
          product: { ...catalog(gtin), article: null, size: null, color: null },
        }),
    });
    const result = await scenario(
      user,
      scan('TEST000000011', randomUUID(), gtin),
    );
    expect(result).toMatchObject({
      ok: true,
      unit: { state: 'AVAILABLE', size: null, color: null },
    });
    expect(
      (await store!.list({ search: gtin, offset: 0, limit: 40 })).items[0],
    ).toMatchObject({ onHand: 1, available: 1, quarantine: 0 });
  });
  it('does not need the provider for a cached receipt, replay or duplicate', async () => {
    const input = scan('TEST000000012');
    const accepted = await receive(user, input);
    if (!accepted.ok) throw Error('fixture');
    const unavailable = vi.fn().mockResolvedValue({ status: 'UNAVAILABLE' });
    const scenario = createReceiveStock({
      receive: (command) => store!.receive(command),
      needsCatalogLookup: (gtin) => store!.needsCatalogLookup(gtin),
      lookupCatalog: unavailable,
      protectMarking,
    });
    expect(await scenario(user, input)).toMatchObject({
      ok: true,
      outcome: 'ACCEPTED',
      replayed: true,
    });
    expect(await scenario(user, scan('TEST000000012'))).toMatchObject({
      ok: true,
      outcome: 'DUPLICATE',
    });
    expect(unavailable).not.toHaveBeenCalled();
  });
  it('uses archive dates without resurrecting an archived catalog variant', async () => {
    const variants = await client!.db
      .select()
      .from(variantIdentifiers)
      .where(eq(variantIdentifiers.gtin, '04660430764604'));
    const variantId = variants[0]!.variantId;
    await client!.db
      .update(productVariants)
      .set({ archivedAt: new Date() })
      .where(eq(productVariants.id, variantId));
    expect(
      await receive(
        user,
        scan('TEST000000013', randomUUID(), '04660430764604'),
      ),
    ).toEqual({ ok: false, code: 'CATALOG_ARCHIVED' });
  });
  it('retains archive protection for a manually mapped model', async () => {
    const [variant] = await client!.db
      .select()
      .from(variantIdentifiers)
      .where(eq(variantIdentifiers.gtin, '04660430764550'));
    const [mapped] = await client!.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variant!.variantId));
    await client!.db
      .update(products)
      .set({ archivedAt: new Date() })
      .where(eq(products.id, mapped!.productId!));
    expect(
      await receive(
        user,
        scan('TEST000000014', randomUUID(), '04660430764550'),
      ),
    ).toEqual({ ok: false, code: 'CATALOG_ARCHIVED' });
  });
  it('removes catalog approval columns and enum from the database schema', async () => {
    expect(
      (
        await client!.db.execute(
          sql`SELECT column_name FROM information_schema.columns WHERE table_name IN ('products','product_variants') AND column_name='review_status'`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await client!.db.execute(
          sql`SELECT typname FROM pg_type WHERE typname='catalog_review'`,
        )
      ).rows,
    ).toHaveLength(0);
  });
});
