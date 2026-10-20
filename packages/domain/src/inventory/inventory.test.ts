import { describe, expect, it, vi } from 'vitest';
import { createReceiveStock, createReadInventory } from './inventory.js';
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
});
