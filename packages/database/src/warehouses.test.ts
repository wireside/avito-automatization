import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createDatabaseClient } from './client.js';
import { createWarehouseSettingsStore } from './warehouses.js';
import { createChzSessionStore } from './chz-session.js';
const url =
  process.env.RUN_WAREHOUSE_TESTS === 'true'
    ? process.env.DATABASE_URL
    : undefined;
(url ? describe : describe.skip)(
  'independent CHZ connection and warehouse settings on a clean database',
  () => {
    const client = createDatabaseClient(url ?? 'postgresql://unused'),
      store = createWarehouseSettingsStore(client.db);
    const actorId = randomUUID(),
      inn = '123456789012';
    const place = { fiasId: randomUUID(), address: 'Адрес из ЧЗ' };
    beforeAll(async () => {
      await client.db.execute(
        sql`INSERT INTO users(id,telegram_id) VALUES(${actorId},${randomUUID()})`,
      );
    });
    afterAll(() => client.pool.end());
    it('connects and selects the INN for authorization before any warehouse has legal settings', async () => {
      expect((await store.list())[0]).toMatchObject({
        name: 'Основной склад',
        isDefault: true,
        configured: false,
      });
      await store.connect(inn, actorId);
      expect(
        await createChzSessionStore(client.db, undefined).sellerInn(),
      ).toBe(inn);
      expect(await store.connection()).toEqual({
        sellerInn: inn,
        canChangeInn: true,
        signerActive: false,
        authorized: false,
      });
      expect(
        (await client.db.execute(sql`SELECT * FROM marking_pipeline_settings`))
          .rows,
      ).toHaveLength(0);
      const sessions = createChzSessionStore(client.db, {
        encrypt: () => ({
          payloadCiphertext: 'fixture',
          encryptionKeyId: 'fixture',
          identityHash: 'fixture',
        }),
        decrypt: () => 'fixture',
      });
      await sessions.challenge(inn, randomUUID(), 'fixture');
      expect(await sessions.pending()).not.toBeNull();
      await store.connect('999999999999', actorId);
      expect(await sessions.pending()).toBeNull();
      expect(
        (
          await client.db.execute(
            sql`SELECT status FROM signer_jobs WHERE purpose='AUTH'`,
          )
        ).rows,
      ).toEqual([{ status: 'EXPIRED' }]);
      expect(
        await createChzSessionStore(client.db, undefined).sellerInn(),
      ).toBe('999999999999');
      await store.connect(inn, actorId);
    });
    it('creates one warehouse and all its locations under concurrent retries', async () => {
      const input = {
        requestId: randomUUID(),
        name: 'Второй склад',
        fiasId: place.fiasId,
      };
      const [a, b] = await Promise.all([
        store.save(input, place, inn, actorId),
        store.save(input, place, inn, actorId),
      ]);
      expect(a).toEqual(b);
      const locations = (
        await client.db.execute(
          sql`SELECT code FROM stock_locations WHERE warehouse_id=${a.warehouseId}`,
        )
      ).rows;
      expect(locations).toHaveLength(3);
      const settings = (
        await client.db.execute(
          sql`SELECT * FROM marking_pipeline_settings WHERE warehouse_id=${a.warehouseId}`,
        )
      ).rows[0];
      expect(settings).toMatchObject({
        seller_inn: inn,
        address: place.address,
        fias_id: place.fiasId,
        fiscal_evidence_reference: null,
      });
      await expect(
        store.replay({ ...input, name: 'Другой склад' }, actorId),
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
      expect((await store.list()).filter((w) => !w.isDefault)).toHaveLength(1);
    });
    it('binds the existing main warehouse without recreating it or changing its default status', async () => {
      const main = (await store.list()).find((w) => w.isDefault)!;
      const result = await store.save(
        {
          requestId: randomUUID(),
          warehouseId: main.id,
          name: main.name,
          fiasId: place.fiasId,
        },
        place,
        inn,
        actorId,
      );
      expect(result.warehouseId).toBe(main.id);
      expect((await store.list()).find((w) => w.isDefault)).toMatchObject({
        id: main.id,
        configured: true,
        address: place.address,
      });
      expect(
        (
          await client.db.execute(
            sql`SELECT fias_id,address FROM warehouses WHERE id=${main.id}`,
          )
        ).rows[0],
      ).toEqual({ fias_id: place.fiasId, address: place.address });
    });
    it('pins the account identity after a warehouse has been configured', async () => {
      expect((await store.connection()).canChangeInn).toBe(false);
      await expect(store.connect('999999999999', actorId)).rejects.toThrow(
        'SELLER_ACCOUNT_MISMATCH',
      );
    });
    it('rejects an unavailable local warehouse and never saves an address under another account', async () => {
      const input = {
        requestId: randomUUID(),
        warehouseId: randomUUID(),
        name: 'Склад',
        fiasId: place.fiasId,
      };
      await expect(store.save(input, place, inn, actorId)).rejects.toThrow(
        'WAREHOUSE_UNAVAILABLE',
      );
      await expect(
        store.save(
          {
            requestId: input.requestId,
            name: input.name,
            fiasId: input.fiasId,
          },
          place,
          '999999999999',
          actorId,
        ),
      ).rejects.toThrow('SELLER_ACCOUNT_MISMATCH');
    });
  },
);
