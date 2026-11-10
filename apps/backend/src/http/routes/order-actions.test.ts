import { afterEach, it, expect, vi } from 'vitest';
import {
  createAvitoOrderActions,
  type AvitoActionStore,
  type AvitoActionProvider,
  type OrderReader,
} from '@avito/domain';
import { buildApp } from '../app.js';
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
async function setup(role = 'OWNER', enabled = true) {
  const store = {
    enqueue: vi.fn<AvitoActionStore['enqueue']>().mockResolvedValue({
      operationId: '00000000-0000-4000-8000-000000000111',
      replayed: false,
    }),
    list: vi.fn<AvitoActionStore['list']>().mockResolvedValue([]),
    load: vi.fn<AvitoActionStore['load']>(),
    start: vi.fn<AvitoActionStore['start']>(),
    reset: vi.fn<AvitoActionStore['reset']>(),
    finish: vi.fn<AvitoActionStore['finish']>(),
    reconcile: vi.fn<AvitoActionStore['reconcile']>(),
  } satisfies AvitoActionStore;
  const provider = {
    execute: vi.fn<AvitoActionProvider['execute']>(),
    courier: vi.fn<AvitoActionProvider['courier']>(),
    download: vi.fn<AvitoActionProvider['download']>(),
  } satisfies AvitoActionProvider;
  const reader = {
    get: vi.fn<OrderReader['get']>(),
    list: vi.fn<OrderReader['list']>(),
  } satisfies OrderReader;
  const app = await buildApp(
    {
      LOG_LEVEL: 'silent',
      MINI_APP_ORIGIN: 'https://example.com',
      TELEGRAM_WEBHOOK_SECRET: undefined,
    },
    {
      verifyTelegramSession: () =>
        Promise.resolve({
          ok: true,
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            telegramId: '1',
            displayName: null,
            roles: [role],
          },
        }),
      checkReadiness: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }),
      avitoOrderActions: createAvitoOrderActions({
        store,
        provider,
        reader,
        writesEnabled: enabled,
      }),
    },
  );
  apps.push(app);
  return { app, store, provider, reader };
}
const headers = { authorization: 'tma fixture' };
const command = {
  requestId: '00000000-0000-4000-8000-000000000100',
  action: 'confirm',
  data: {},
};
it('authenticates before queuing or reading actions', async () => {
  const { app, store } = await setup();
  for (const method of ['GET', 'POST'] as const)
    expect(
      (
        await app.inject({
          method,
          url: '/api/v1/orders/123/actions',
          ...(method === 'POST' ? { payload: command } : {}),
        })
      ).statusCode,
    ).toBe(401);
  expect(store.enqueue).not.toHaveBeenCalled();
  expect(store.list).not.toHaveBeenCalled();
});
it('queues a typed idempotent command without making a provider call in HTTP', async () => {
  const { app, store, provider, reader } = await setup();
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/orders/123/actions',
    headers,
    payload: command,
  });
  expect(result.statusCode).toBe(200);
  expect(result.json<{ operationId: string }>().operationId).toBe(
    '00000000-0000-4000-8000-000000000111',
  );
  expect(store.enqueue).toHaveBeenCalledWith(
    '123',
    command,
    expect.any(String),
  );
  expect(provider.execute).not.toHaveBeenCalled();
  expect(reader.get).not.toHaveBeenCalled();
});
it.each(['VIEWER', 'ACCOUNTANT'])(
  'refuses write and reconciliation for %s',
  async (role) => {
    const { app, store } = await setup(role);
    for (const suffix of [
      'actions',
      'actions/00000000-0000-4000-8000-000000000111/reconcile',
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/orders/123/' + suffix,
            headers,
            payload: command,
          })
        ).statusCode,
      ).toBe(403);
    expect(store.enqueue).not.toHaveBeenCalled();
    expect(store.reconcile).not.toHaveBeenCalled();
  },
);
it('keeps the flag fail-closed and still reports read-only action state', async () => {
  const { app, store } = await setup('OWNER', false);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/orders/123/actions',
        headers,
        payload: command,
      })
    ).statusCode,
  ).toBe(409);
  const list = await app.inject({
    method: 'GET',
    url: '/api/v1/orders/123/actions',
    headers,
  });
  expect(list.json()).toEqual({ writesEnabled: false, operations: [] });
  expect(store.enqueue).not.toHaveBeenCalled();
});
it.each([
  { ...command, requestId: 'not-uuid' },
  { ...command, action: 'setMarkings', data: { markings: ['unsafe'] } },
  { ...command, action: 'setTrackNumber', data: { trackingNumber: '' } },
  {
    ...command,
    action: 'acceptReturnOrder',
    data: { terminalNumber: 'bad', name: 'Test', phone: 'bad' },
  },
  {
    ...command,
    action: 'setCourierDeliveryRange',
    data: {
      address: 'Address',
      name: 'Test',
      phone: '+79999999999',
      startDate: '2026-11-10T13:00:00Z',
      endDate: '2026-11-10T12:00:00Z',
      intervalType: 'fixed',
    },
  },
])('rejects invalid action input before storage', async (payload) => {
  const { app, store } = await setup();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/orders/123/actions',
        headers,
        payload,
      })
    ).statusCode,
  ).toBe(400);
  expect(store.enqueue).not.toHaveBeenCalled();
});
it('takes the courier address in a body and never accepts a provider URL', async () => {
  const { app, provider } = await setup('VIEWER');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/orders/123/courier-options',
        headers,
        payload: { address: 'Address' },
      })
    ).statusCode,
  ).toBe(403);
  expect(provider.courier).not.toHaveBeenCalled();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/orders/123/courier-options',
        headers,
        payload: { url: 'https://attacker.example' },
      })
    ).statusCode,
  ).toBe(400);
});
it('publishes all new routes in OpenAPI', async () => {
  const { app } = await setup();
  const response = await app.inject('/api/v1/openapi.json');
  expect(response.statusCode).toBe(200);
  const doc = response.json<{ paths: Record<string, unknown> }>();
  for (const path of [
    '/api/v1/orders/{id}/actions',
    '/api/v1/orders/{id}/courier-options',
    '/api/v1/orders/{id}/actions/{operationId}/label',
    '/api/v1/orders/{id}/actions/{operationId}/reconcile',
  ])
    expect(doc.paths).toHaveProperty(path);
});
