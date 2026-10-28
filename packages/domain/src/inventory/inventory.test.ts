import { describe, expect, it, vi } from 'vitest';
import { createReceiveStock, createReadInventory } from './inventory.js';
import type { ReceiptCatalog } from './receipt-catalog.js';
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
describe('inventory scenarios', () => {
  it('checks authority and format before encryption and persistence', async () => {
    const receive = vi.fn();
    const protectMarking = vi.fn();
    const scenario = createReceiveStock({ receive, protectMarking });
    expect(await scenario({ ...user, roles: ['VIEWER'] }, input)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await scenario(user, { ...input, raw: 'invalid' })).toEqual({
      ok: false,
      code: 'INVALID_MARKING',
    });
    expect(receive).not.toHaveBeenCalled();
    expect(protectMarking).not.toHaveBeenCalled();
  });
  it('refuses plaintext fallback without configured protection', async () => {
    const receive = vi.fn();
    expect(await createReceiveStock({ receive })(user, input)).toEqual({
      ok: false,
      code: 'MARKING_STORAGE_NOT_CONFIGURED',
    });
    expect(receive).not.toHaveBeenCalled();
  });
  it('passes original bytes to protection and omits plaintext from persistence', async () => {
    const receive = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'WAREHOUSE_UNAVAILABLE' });
    const protectMarking = vi.fn().mockReturnValue({
      identityHash: 'hash',
      inputFingerprint: 'fingerprint',
      payloadCiphertext: 'encrypted',
      encryptionKeyId: 'test',
    });
    await createReceiveStock({ receive, protectMarking })(user, input);
    expect(protectMarking).toHaveBeenCalledWith(
      input.raw,
      '010466043076454321TEST000000001',
    );
    expect(receive.mock.calls[0]?.[0]).not.toHaveProperty('raw');
    expect(JSON.stringify(receive.mock.calls)).not.toContain(input.raw);
  });
  it('denies readers without a warehouse role', async () => {
    const list = vi.fn(),
      units = vi.fn();
    const scenario = createReadInventory({ list, units });
    expect(
      await scenario.list(
        { ...user, roles: [] },
        { search: '', offset: 0, limit: 40 },
      ),
    ).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(list).not.toHaveBeenCalled();
  });
  it('looks up only the parsed GTIN after access, format and encryption checks', async () => {
    const lookupCatalog = vi.fn().mockResolvedValue({ status: 'NOT_FOUND' });
    const receive = vi.fn().mockResolvedValue({
      ok: true,
      outcome: 'ACCEPTED',
      unit: {},
      replayed: false,
    });
    const protectMarking = vi
      .fn()
      .mockReturnValue({ payloadCiphertext: 'encrypted' });
    const scenario = createReceiveStock({
      receive,
      lookupCatalog,
      protectMarking,
    });
    await scenario({ ...user, roles: ['VIEWER'] }, input);
    await scenario(user, { ...input, raw: 'invalid' });
    await createReceiveStock({ receive, lookupCatalog })(user, input);
    expect(lookupCatalog).not.toHaveBeenCalled();
    expect(await scenario(user, input)).toMatchObject({
      ok: true,
      catalogLookup: 'NOT_FOUND',
    });
    expect(lookupCatalog).toHaveBeenCalledExactlyOnceWith('04660430764543');
    expect(protectMarking.mock.invocationCallOrder[0]).toBeLessThan(
      lookupCatalog.mock.invocationCallOrder[0]!,
    );
  });
  it('persists enrichment and skips the remote request when the variant is already saved', async () => {
    const product: ReceiptCatalog = {
      gtin: '04660430764543',
      sourceReference: 'national-catalog:123',
      observedAt: '2026-10-27T12:00:00.000Z',
      status: 'RESOLVED',
      name: 'Брюки ZZ-8 белый XL',
      sourceName: 'Брюки',
      article: 'ZZ-8',
      color: 'белый',
      size: 'XL',
      sizeSystem: null,
      materialComposition: null,
      attributes: [],
    };
    const receive = vi.fn().mockResolvedValue({
      ok: true,
      unit: {},
      outcome: 'ACCEPTED',
      replayed: false,
    });
    const lookupCatalog = vi
      .fn()
      .mockResolvedValue({ status: 'FOUND', product });
    const needsCatalogLookup = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const scenario = createReceiveStock({
      receive,
      lookupCatalog,
      needsCatalogLookup,
      protectMarking: () => ({
        identityHash: 'hash',
        inputFingerprint: 'fingerprint',
        payloadCiphertext: 'encrypted',
        encryptionKeyId: 'test',
      }),
    });
    await scenario(user, input);
    expect(receive).toHaveBeenLastCalledWith(
      expect.objectContaining({ catalog: product }),
    );
    await scenario(user, input);
    expect(lookupCatalog).toHaveBeenCalledTimes(1);
    expect(receive.mock.calls[1]?.[0]).not.toHaveProperty('catalog');
  });
  it('still receives into quarantine if the provider fails, without leaking errors or plaintext', async () => {
    const receive = vi.fn().mockResolvedValue({
      ok: true,
      outcome: 'ACCEPTED',
      unit: { state: 'QUARANTINE' },
      replayed: false,
    });
    const scenario = createReceiveStock({
      receive,
      lookupCatalog: () => Promise.reject(new Error('sensitive provider URL')),
      protectMarking: () => ({
        identityHash: 'hash',
        inputFingerprint: 'fingerprint',
        payloadCiphertext: 'encrypted',
        encryptionKeyId: 'test',
      }),
    });
    const result = await scenario(user, input);
    expect(result).toMatchObject({
      ok: true,
      catalogLookup: 'UNAVAILABLE',
      unit: { state: 'QUARANTINE' },
    });
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(receive.mock.calls[0]?.[0]).not.toHaveProperty('raw');
  });
});
