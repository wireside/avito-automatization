import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createWarehouseSettings,
  ProviderError,
  type WarehouseSettingsStore,
} from '@avito/domain';
import { buildApp } from '../app.js';
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(() => Promise.all(apps.splice(0).map((a) => a.close())));
const headers = { authorization: 'tma signed' };
async function setup(roles = ['OWNER']) {
  const store = {
    list: vi.fn().mockResolvedValue([]),
    connection: vi.fn().mockResolvedValue({
      sellerInn: '123456789012',
      signerActive: true,
      authorized: true,
    }),
    connect: vi.fn(),
    replay: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({ warehouseId: randomUUID() }),
  } satisfies WarehouseSettingsStore;
  const places = vi.fn().mockResolvedValue({ items: [], incompleteCount: 0 });
  const app = await buildApp(
    {
      LOG_LEVEL: 'silent',
      MINI_APP_ORIGIN: 'https://example.test',
      TELEGRAM_WEBHOOK_SECRET: undefined,
    },
    {
      checkReadiness: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }),
      verifyTelegramSession: () =>
        Promise.resolve({
          ok: true,
          user: { id: randomUUID(), telegramId: '1', displayName: null, roles },
        }),
      warehouseSettings: createWarehouseSettings({ store, places }),
    },
  );
  apps.push(app);
  return { app, store, places };
}
it('requires authentication and forbids browser-supplied addresses and seller identities on warehouse writes', async () => {
  const { app, store } = await setup();
  expect((await app.inject('/api/v1/warehouses')).statusCode).toBe(401);
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/warehouses',
    headers,
    payload: {
      requestId: randomUUID(),
      name: 'Склад',
      fiasId: randomUUID(),
      address: 'Подставной адрес',
      sellerInn: '999999999999',
    },
  });
  expect(response.statusCode).toBe(400);
  expect(store.save).not.toHaveBeenCalled();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/marking/commands/configure',
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  const doc = (await app.inject('/api/v1/openapi.json')).json<{
    paths: Record<string, unknown>;
  }>();
  expect(doc.paths['/api/v1/chz/places']).toBeDefined();
  expect(doc.paths['/api/v1/marking/commands/configure']).toBeUndefined();
});
it('lets warehouse staff list warehouses but not load private CHZ places or change the account', async () => {
  const { app, places, store } = await setup(['WAREHOUSE']);
  expect(
    (await app.inject({ url: '/api/v1/warehouses', headers })).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ url: '/api/v1/chz/places', headers })).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/chz/connection',
        headers,
        payload: { sellerInn: '123456789012' },
      })
    ).statusCode,
  ).toBe(403);
  expect(places).not.toHaveBeenCalled();
  expect(store.connect).not.toHaveBeenCalled();
});
it('returns auth-required separately from an empty places list and sanitizes provider failures', async () => {
  const { app, places } = await setup();
  places.mockRejectedValueOnce(new ProviderError('CHZ_AUTH_REQUIRED', true));
  const waiting = await app.inject({ url: '/api/v1/chz/places', headers });
  expect(waiting.statusCode).toBe(409);
  expect(waiting.json()).toMatchObject({ code: 'CHZ_AUTH_REQUIRED' });
  const empty = await app.inject({ url: '/api/v1/chz/places', headers });
  expect(empty.statusCode).toBe(200);
  expect(empty.json()).toMatchObject({ items: [] });
});
