import { describe, expect, it, vi } from 'vitest';
import {
  createReceiveStock,
  createReadInventory,
  type ReceiptResult,
} from './inventory.js';
import type { ReceiptCatalog, CatalogLookupResult } from './receipt-catalog.js';
const user = {
  id: 'user',
  telegramId: '42',
  displayName: null,
  roles: ['OWNER'],
};
const input = {
  requestId: 'request',
  raw: '010466043076454321TEST000000001\u001d91ABCD\u001d92' + 'A'.repeat(44),
  scannerProfile: 'camera-gs1-v1' as const,
};
const product: ReceiptCatalog = {
  gtin: '04660430764543',
  sourceReference: 'national-catalog:123',
  observedAt: '2026-10-27T12:00:00.000Z',
  name: 'Брюки ZZ-8 белый XL',
  sourceName: 'Брюки',
  article: 'ZZ-8',
  color: 'белый',
  size: 'XL',
  sizeSystem: null,
  materialComposition: null,
  attributes: [],
};
const protectMarking = () => ({
  identityHash: 'hash',
  inputFingerprint: 'fingerprint',
  payloadCiphertext: 'encrypted',
  encryptionKeyId: 'test',
});
describe('inventory scenarios without an approval stage', () => {
  it('checks access and format before encryption, catalog or persistence', async () => {
    const receive = vi.fn(),
      lookupCatalog = vi.fn(),
      protect = vi.fn();
    const scenario = createReceiveStock({
      receive,
      lookupCatalog,
      protectMarking: protect,
    });
    expect(await scenario({ ...user, roles: ['VIEWER'] }, input)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await scenario(user, { ...input, raw: 'invalid' })).toEqual({
      ok: false,
      code: 'INVALID_MARKING',
    });
    expect(receive).not.toHaveBeenCalled();
    expect(lookupCatalog).not.toHaveBeenCalled();
    expect(protect).not.toHaveBeenCalled();
  });
  it('refuses plaintext fallback', async () => {
    const receive = vi.fn();
    expect(await createReceiveStock({ receive })(user, input)).toEqual({
      ok: false,
      code: 'MARKING_STORAGE_NOT_CONFIGURED',
    });
    expect(receive).not.toHaveBeenCalled();
  });
  it('preserves original marking bytes and passes only parsed GTIN to the provider', async () => {
    const receive = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'WAREHOUSE_UNAVAILABLE' });
    const lookupCatalog = vi
      .fn()
      .mockResolvedValue({ status: 'FOUND', product });
    const protect = vi.fn(protectMarking);
    await createReceiveStock({
      receive,
      lookupCatalog,
      protectMarking: protect,
    })(user, input);
    expect(protect).toHaveBeenCalledWith(
      input.raw,
      '010466043076454321TEST000000001',
    );
    expect(lookupCatalog).toHaveBeenCalledExactlyOnceWith(product.gtin);
    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({ catalog: product }),
    );
    expect(receive.mock.calls[0]?.[0]).not.toHaveProperty('raw');
  });
  it('reuses stored catalog data without a remote request', async () => {
    const receive = vi.fn().mockResolvedValue({
      ok: true,
      outcome: 'ACCEPTED',
      unit: { state: 'AVAILABLE' },
      replayed: false,
    });
    const lookupCatalog = vi.fn();
    const result = await createReceiveStock({
      receive,
      lookupCatalog,
      needsCatalogLookup: () => Promise.resolve(false),
      protectMarking,
    })(user, input);
    expect(result).toMatchObject({ ok: true, unit: { state: 'AVAILABLE' } });
    expect(result).not.toHaveProperty('catalogLookup');
    expect(lookupCatalog).not.toHaveBeenCalled();
  });
  it.each([
    ['NOT_FOUND', 'CATALOG_NOT_FOUND'],
    ['UNAVAILABLE', 'CATALOG_UNAVAILABLE'],
    ['NOT_CONFIGURED', 'CATALOG_NOT_CONFIGURED'],
    ['AMBIGUOUS', 'CATALOG_AMBIGUOUS'],
  ] as const)(
    'rejects new receipt on %s rather than storing pending stock',
    async (status, code) => {
      const receive = vi
        .fn()
        .mockResolvedValue({ ok: false, code: 'CATALOG_NOT_FOUND' });
      expect(
        await createReceiveStock({
          receive,
          lookupCatalog: () => Promise.resolve({ status }),
          protectMarking,
        })(user, input),
      ).toEqual({ ok: false, code });
      expect(receive.mock.calls[0]?.[0]).not.toHaveProperty('catalog');
    },
  );
  it('does not treat a missing integration as an accepted physical receipt', async () => {
    expect(
      await createReceiveStock({
        receive: () =>
          Promise.resolve({ ok: false, code: 'CATALOG_NOT_FOUND' }),
        protectMarking,
      })(user, input),
    ).toEqual({ ok: false, code: 'CATALOG_NOT_CONFIGURED' });
  });
  it('does not leak provider errors or use mismatched data', async () => {
    for (const lookupCatalog of [
      () => Promise.reject(new Error('sensitive URL')),
      () =>
        Promise.resolve({
          status: 'FOUND',
          product: { ...product, gtin: '04660430764550' },
        } as CatalogLookupResult),
    ]) {
      const receive = vi
        .fn()
        .mockResolvedValue({ ok: false, code: 'CATALOG_NOT_FOUND' });
      const result = await createReceiveStock({
        receive,
        lookupCatalog,
        protectMarking,
      })(user, input);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('sensitive');
      expect(receive.mock.calls[0]?.[0]).not.toHaveProperty('catalog');
    }
  });
  it.each([false, true])(
    'keeps duplicate/replay idempotency available during catalog downtime (replay=%s)',
    async (replayed) => {
      const stored = {
        ok: true,
        outcome: replayed ? 'ACCEPTED' : 'DUPLICATE',
        unit: { state: 'AVAILABLE' },
        replayed,
      } as ReceiptResult;
      const scenario = createReceiveStock({
        receive: () => Promise.resolve(stored),
        lookupCatalog: () => Promise.resolve({ status: 'UNAVAILABLE' }),
        protectMarking,
      });
      expect(await scenario(user, input)).toEqual(stored);
    },
  );
  it('denies inventory reads without warehouse roles', async () => {
    const list = vi.fn(),
      units = vi.fn();
    expect(
      await createReadInventory({ list, units }).list(
        { ...user, roles: [] },
        { search: '', offset: 0, limit: 40 },
      ),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(list).not.toHaveBeenCalled();
  });
});
