import { afterEach, it, expect, vi } from 'vitest';
import {
  createAvitoOrderActions,
  PipelineError,
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
  const findActiveUser = vi.fn().mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000001',
    telegramId: '1',
    displayName: null,
    roles: [role],
  });
  const app = await buildApp(
    {
      LOG_LEVEL: 'silent',
      MINI_APP_ORIGIN: 'https://example.com',
      TELEGRAM_WEBHOOK_SECRET: undefined,
    },
    {
      labelDownloadLinks: {
        issue: () => ({
          url: 'https://api.example.com/avito/label#fixture',
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        }),
        resolve: async (ticket) => {
          const user = (await findActiveUser()) as
            | {
                id: string;
                telegramId: string;
                displayName: null;
                roles: string[];
              }
            | undefined;
          if (ticket !== 'fixture' || !user)
            throw new PipelineError('UNAUTHORIZED');
          return {
            user,
            orderId: '123',
            operationId: '00000000-0000-4000-8000-000000000111',
          };
        },
      },
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
  return { app, store, provider, reader, findActiveUser };
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
    '/api/v1/orders/{id}/actions/{operationId}/label-link',
    '/api/v1/avito-label/download',
    '/api/v1/orders/{id}/actions/{operationId}/reconcile',
  ])
    expect(doc.paths).toHaveProperty(path);
});

it('exports labels via fragment tickets and POST while rechecking live access and order binding', async () => {
  const { app, store, provider, findActiveUser } = await setup();
  const operationId = '00000000-0000-4000-8000-000000000111';
  const path = `/api/v1/orders/123/actions/${operationId}/label-link`;
  expect((await app.inject({ method: 'POST', url: path })).statusCode).toBe(
    401,
  );
  expect(
    (await app.inject({ method: 'POST', url: path, headers })).statusCode,
  ).toBe(409);
  store.list.mockResolvedValue([
    {
      id: operationId,
      action: 'label',
      status: 'SUCCEEDED',
      errorCode: null,
      createdAt: new Date().toISOString(),
      labelReady: true,
      reconcilable: false,
    },
  ]);
  const response = await app.inject({ method: 'POST', url: path, headers });
  expect(response.statusCode).toBe(200);
  expect(provider.download).not.toHaveBeenCalled();
  const url = new URL(response.json<{ url: string }>().url);
  const ticket = url.hash.slice(1);
  const page = await app.inject(url.pathname);
  expect(page.statusCode).toBe(200);
  expect(page.headers['referrer-policy']).toBe('no-referrer');
  expect(page.headers['cache-control']).toBe('no-store');
  expect(page.headers['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  );
  store.load.mockResolvedValue({
    id: operationId,
    orderId: '123',
    command: { action: 'label', requestId: operationId, data: {} },
    started: true,
    result: { labelTaskId: 'task' },
  });
  provider.download.mockResolvedValue(Buffer.from('%PDF-fixture'));
  const download = () =>
    app.inject({
      method: 'POST',
      url: '/api/v1/avito-label/download',
      payload: { ticket },
    });
  const pdf = await download();
  expect(pdf.statusCode).toBe(200);
  expect(pdf.headers['content-type']).toBe('application/pdf');
  expect(pdf.headers['content-disposition']).toContain(
    'attachment; filename="avito-label.pdf"',
  );
  expect(pdf.headers['cache-control']).toBe('no-store');
  expect(pdf.body).toBe('%PDF-fixture');
  expect(provider.download).toHaveBeenCalledWith('task');
  provider.download.mockClear();
  store.load.mockResolvedValueOnce({
    id: operationId,
    orderId: '999',
    command: { action: 'label', requestId: operationId, data: {} },
    started: true,
    result: { labelTaskId: 'other-task' },
  });
  expect((await download()).statusCode).toBe(409);
  findActiveUser.mockResolvedValueOnce({
    id: '00000000-0000-4000-8000-000000000001',
    telegramId: '1',
    displayName: null,
    roles: [],
  });
  expect((await download()).statusCode).toBe(403);
  findActiveUser.mockResolvedValueOnce(undefined);
  expect((await download()).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/avito-label/download',
        payload: { ticket: 'invalid' },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/avito-label/download',
        payload: { ticket, orderId: '999' },
      })
    ).statusCode,
  ).toBe(400);
  expect(provider.download).not.toHaveBeenCalled();
});
