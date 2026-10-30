import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiErrorResponseSchema,
  inventoryPageResponseSchema,
  inventoryScanResponseSchema,
  inventoryUnitsResponseSchema,
} from '@avito/contracts';
import {
  createReadInventory,
  createReceiveStock,
  type InventoryPage,
  type InventoryQuery,
  type InventoryUnit,
  type ReceiptCommand,
  type ReceiptResult,
  type ReceiveStock,
  type SessionResult,
} from '@avito/domain';
import { buildApp, type HttpServices } from '../app.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const userId = 'b0000000-0000-4000-8000-000000000001';
const unit: InventoryUnit = {
  id: '10000000-0000-4000-8000-000000000001',
  internalCode: 'U-test',
  variantId: '20000000-0000-4000-8000-000000000001',
  name: 'Товар 04660430764543',
  maskedCode: '04660430764543 · •••0001',
  state: 'AVAILABLE',
  location: 'Основное хранение',
  receiptId: '30000000-0000-4000-8000-000000000001',
  receiptNumber: 'SCAN-test',
  receivedAt: '2026-10-20T12:00:00.000Z',
};
const page: InventoryPage = {
  warehouse: {
    id: '40000000-0000-4000-8000-000000000001',
    name: 'Основной склад',
  },
  totals: { onHand: 1, available: 1, quarantine: 0 },
  items: [],
  hasMore: false,
};
async function setup(
  roles = ['OWNER'],
  overrides: Partial<HttpServices> = {},
  inventoryConfigured = true,
) {
  const persist = vi
    .fn<(command: ReceiptCommand) => Promise<ReceiptResult>>()
    .mockResolvedValue({
      ok: true,
      outcome: 'ACCEPTED',
      unit,
      replayed: false,
    });
  const list = vi
    .fn<(query: InventoryQuery) => Promise<InventoryPage>>()
    .mockResolvedValue(page);
  const units = vi
    .fn<
      (
        variantId: string,
        offset: number,
      ) => Promise<{ items: InventoryUnit[]; hasMore: boolean }>
    >()
    .mockResolvedValue({ items: [unit], hasMore: false });
  const verifyTelegramSession = vi
    .fn<(data: string) => Promise<SessionResult>>()
    .mockImplementation((data) =>
      Promise.resolve(
        data === 'signed'
          ? {
              ok: true,
              user: { id: userId, telegramId: '42', displayName: null, roles },
            }
          : { ok: false, code: 'INVALID_SIGNATURE' },
      ),
    );
  const app = await buildApp(
    {
      LOG_LEVEL: 'silent',
      MINI_APP_ORIGIN: 'https://app.example.com',
      TELEGRAM_WEBHOOK_SECRET: undefined,
    },
    {
      verifyTelegramSession,
      checkReadiness: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }),
      ...(inventoryConfigured
        ? {
            receiveStock: createReceiveStock({
              receive: persist,
              protectMarking: () => ({
                identityHash: 'hash',
                inputFingerprint: 'fingerprint',
                payloadCiphertext: 'encrypted',
                encryptionKeyId: 'test',
              }),
            }),
            readInventory: createReadInventory({ list, units }),
          }
        : {}),
      ...overrides,
    },
  );
  apps.push(app);
  return { app, persist, list, units, verifyTelegramSession };
}
const payload = {
  requestId: '123e4567-e89b-42d3-a456-426614174000',
  raw: '010466043076454321TEST000000001\u001d91ABCD\u001d92' + 'A'.repeat(44),
  scannerProfile: 'camera-gs1-v1',
};
const headers = { authorization: 'tma signed' };
describe('protected warehouse HTTP API', () => {
  it('rejects unsigned requests before identity and storage access', async () => {
    const { app, persist, list, verifyTelegramSession } = await setup();
    const response = await app.inject('/api/v1/inventory');
    expect(response.statusCode).toBe(401);
    const error = apiErrorResponseSchema.parse(response.json());
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.requestId).toBe(response.headers['x-correlation-id']);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/inventory/receipts/scan',
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(verifyTelegramSession).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
  it.each(['Bearer signed', 'tma ', 'wrong signed'])(
    'rejects unsupported authorization %s',
    async (authorization) => {
      const { app, verifyTelegramSession } = await setup();
      expect(
        (
          await app.inject({
            url: '/api/v1/inventory',
            headers: { authorization },
          })
        ).statusCode,
      ).toBe(401);
      expect(verifyTelegramSession).not.toHaveBeenCalled();
    },
  );
  it('accepts the case-insensitive HTTP scheme and verifies every request', async () => {
    const { app, verifyTelegramSession } = await setup();
    for (let n = 0; n < 2; n++)
      expect(
        (
          await app.inject({
            url: '/api/v1/inventory',
            headers: { authorization: 'TMA signed' },
          })
        ).statusCode,
      ).toBe(200);
    expect(verifyTelegramSession).toHaveBeenCalledTimes(2);
  });
  it('rejects forged identity and VIEWER writes, while permitting VIEWER reads', async () => {
    const { app, persist } = await setup(['VIEWER']);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/inventory/receipts/scan',
          headers: { authorization: 'tma forged' },
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/inventory/receipts/scan',
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/api/v1/inventory', headers })).statusCode,
    ).toBe(200);
    expect(persist).not.toHaveBeenCalled();
  });
  it('rejects inventory reads without a supported role', async () => {
    const { app, list } = await setup([]);
    expect(
      (await app.inject({ url: '/api/v1/inventory', headers })).statusCode,
    ).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });
  it('validates and passes pagination and Unicode search to the domain scenario', async () => {
    const { app, list } = await setup();
    const response = await app.inject({
      url:
        '/api/v1/inventory?search=' +
        encodeURIComponent('чёрный 208-1') +
        '&offset=40&limit=20',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(inventoryPageResponseSchema.parse(response.json())).toEqual({
      ok: true,
      ...page,
    });
    expect(list).toHaveBeenCalledWith({
      search: 'чёрный 208-1',
      offset: 40,
      limit: 20,
    });
    await app.inject({ url: '/api/v1/inventory', headers });
    expect(list).toHaveBeenLastCalledWith({ search: '', offset: 0, limit: 40 });
  });
  it('passes the variant UUID and offset to the unit reader', async () => {
    const { app, units } = await setup();
    const response = await app.inject({
      url: `/api/v1/inventory/variants/${unit.variantId}/units?offset=20`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(inventoryUnitsResponseSchema.parse(response.json())).toEqual({
      ok: true,
      items: [unit],
      hasMore: false,
    });
    expect(units).toHaveBeenCalledWith(unit.variantId, 20);
  });
  it('saves an authorized scan with a server-derived actor and unchanged original input', async () => {
    const { app, persist } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/receipts/scan',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(inventoryScanResponseSchema.parse(response.json())).toEqual({
      ok: true,
      outcome: 'ACCEPTED',
      unit,
      replayed: false,
    });
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: userId,
        payloadCiphertext: 'encrypted',
        gtin: '04660430764543',
      }),
    );
    expect(response.body).not.toContain(payload.raw);
  });
  it.each([
    ['DUPLICATE', false],
    ['ACCEPTED', true],
  ] as const)(
    'returns 200 for %s with replayed=%s',
    async (outcome, replayed) => {
      const { app, persist } = await setup();
      persist.mockResolvedValue({ ok: true, outcome, unit, replayed });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory/receipts/scan',
        headers,
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ outcome, replayed });
    },
  );
  it.each([
    ['INVALID_MARKING', 422],
    ['INVALID_GTIN', 422],
    ['MARKING_STORAGE_NOT_CONFIGURED', 503],
    ['WAREHOUSE_UNAVAILABLE', 503],
    ['CATALOG_ARCHIVED', 409],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['CATALOG_NOT_FOUND', 422],
    ['CATALOG_UNAVAILABLE', 503],
    ['CATALOG_NOT_CONFIGURED', 503],
    ['CATALOG_AMBIGUOUS', 409],
  ] as const)('maps domain failure %s to %s', async (code, status) => {
    const receiveStock = vi
      .fn<ReceiveStock>()
      .mockResolvedValue({ ok: false, code });
    const { app } = await setup(['OWNER'], { receiveStock });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/receipts/scan',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(status);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(code);
  });
  it('uses the same response contract when inventory dependencies are absent', async () => {
    const { app } = await setup(['OWNER'], {}, false);
    for (const response of [
      await app.inject({ url: '/api/v1/inventory', headers }),
      await app.inject({
        method: 'POST',
        url: '/api/v1/inventory/receipts/scan',
        headers,
        payload,
      }),
    ]) {
      expect(response.statusCode).toBe(503);
      expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
        'INVENTORY_NOT_CONFIGURED',
      );
    }
  });
  it('rejects invalid request shapes before calling the scenario', async () => {
    const { app, persist, list, units } = await setup();
    for (const url of [
      '/api/v1/inventory?limit=10000',
      '/api/v1/inventory?offset=-1',
      '/api/v1/inventory?surprise=true',
      '/api/v1/inventory/variants/not-uuid/units',
      `/api/v1/inventory/variants/${unit.variantId}/units?offset=1.5`,
    ])
      expect((await app.inject({ url, headers })).statusCode).toBe(400);
    for (const body of [
      { ...payload, actorUserId: 'forged' },
      { ...payload, requestId: 'invalid' },
      { ...payload, raw: '' },
      { ...payload, scannerProfile: 'unknown' },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/inventory/receipts/scan',
            headers,
            payload: body,
          })
        ).statusCode,
      ).toBe(400);
    expect(persist).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(units).not.toHaveBeenCalled();
  });
  it('strips accidentally supplied storage fields from successful responses', async () => {
    const { app, persist } = await setup();
    persist.mockResolvedValue({
      ok: true,
      outcome: 'ACCEPTED',
      unit: {
        ...unit,
        ...{
          raw: payload.raw,
          payloadCiphertext: 'private-ciphertext',
          identityHash: 'private-hash',
        },
      },
      replayed: false,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/receipts/scan',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      ok: true,
      outcome: 'ACCEPTED',
      unit,
      replayed: false,
    });
    expect(response.body).not.toContain('private-');
  });
  it('returns saved catalog fields immediately without returning provider payloads', async () => {
    const { app, persist } = await setup();
    persist.mockResolvedValue({
      ok: true,
      outcome: 'ACCEPTED',
      replayed: false,
      unit: {
        ...unit,
        name: 'Брюки ZZ-8 белый XL',
        article: 'ZZ-8',
        color: 'белый',
        size: 'XL',
        sizeSystem: 'ЕВРОПА',
        ...{ sourceReference: 'private-provider-reference' },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/receipts/scan',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(inventoryScanResponseSchema.parse(response.json())).toMatchObject({
      unit: {
        name: 'Брюки ZZ-8 белый XL',
        article: 'ZZ-8',
        color: 'белый',
        size: 'XL',
      },
    });
    expect(response.body).not.toContain('private-provider-reference');
    expect(response.body).not.toContain(payload.raw);
  });
  it('masks unexpected exceptions and failed response validation', async () => {
    const { app, persist, list } = await setup();
    persist.mockRejectedValue(
      new Error('SQL failure with raw ' + payload.raw + ' and private token'),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory/receipts/scan',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(500);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'INTERNAL_ERROR',
    );
    expect(response.body).not.toMatch(/SQL|TEST000|private token|stack/);
    list.mockResolvedValue({
      ...page,
      warehouse: { ...page.warehouse, id: 'broken' },
    });
    const malformed = await app.inject({ url: '/api/v1/inventory', headers });
    expect(malformed.statusCode).toBe(500);
    expect(malformed.body).not.toContain('broken');
  });
  it.each([
    ['application/json', '{"raw":', 400, 'INVALID_JSON'],
    ['application/octet-stream', 'unsupported', 415, 'UNSUPPORTED_MEDIA_TYPE'],
    [
      'application/json',
      JSON.stringify({ raw: 'x'.repeat(5000) }),
      413,
      'PAYLOAD_TOO_LARGE',
    ],
  ] as const)(
    'normalizes parser errors: %s %s',
    async (contentType, body, status, code) => {
      const { app, persist } = await setup();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory/receipts/scan',
        headers: { ...headers, 'content-type': contentType },
        payload: body,
      });
      expect(response.statusCode).toBe(status);
      expect(apiErrorResponseSchema.parse(response.json()).code).toBe(code);
      expect(persist).not.toHaveBeenCalled();
    },
  );
});
