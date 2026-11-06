import { randomUUID } from 'node:crypto';
import { it, expect, afterEach, vi } from 'vitest';
import { createMarkingPipeline, type PipelineStore } from '@avito/domain';
import { buildApp } from '../app.js';
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(() => Promise.all(apps.splice(0).map((a) => a.close())));
async function setup(roles = ['OWNER']) {
  const store = {
    execute: vi
      .fn()
      .mockResolvedValue({ ok: true, replayed: false, result: {} }),
    read: vi.fn().mockResolvedValue({ data: [] }),
    reconcile: vi.fn(),
  } satisfies PipelineStore;
  const app = await buildApp(
    {
      LOG_LEVEL: 'silent',
      MINI_APP_ORIGIN: 'https://example.test',
      TELEGRAM_WEBHOOK_SECRET: undefined,
    },
    {
      verifyTelegramSession: () =>
        Promise.resolve({
          ok: true,
          user: { id: randomUUID(), telegramId: '1', displayName: null, roles },
        }),
      checkReadiness: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }),
      markingPipeline: createMarkingPipeline(store),
    },
  );
  apps.push(app);
  return { app, store };
}
const headers = { authorization: 'tma signed' };
it('authenticates before commands and rejects undocumented fields', async () => {
  const { app, store } = await setup(),
    url = '/api/v1/marking/commands/check';
  expect(
    (await app.inject({ method: 'POST', url, payload: {} })).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers,
        payload: {
          requestId: randomUUID(),
          unitId: randomUUID(),
          legalState: 'IN_CIRCULATION',
        },
      })
    ).statusCode,
  ).toBe(400);
  expect(store.execute).not.toHaveBeenCalled();
});
it('keeps viewers read-only and protects document exports', async () => {
  const { app, store } = await setup(['VIEWER']);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/marking/commands/check',
        headers,
        payload: { requestId: randomUUID(), unitId: randomUUID() },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/marking/issues',
        headers,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/marking/documents/' + randomUUID() + '/export',
        headers,
      })
    ).statusCode,
  ).toBe(403);
  expect(store.execute).not.toHaveBeenCalled();
});
it('supports local configuration and publishes provider/agent contracts', async () => {
  const { app } = await setup();
  const r = await app.inject({
    method: 'GET',
    url: '/api/v1/marking/integrations',
    headers,
  });
  expect(r.headers['cache-control']).toBe('no-store');
  const doc = (await app.inject('/api/v1/openapi.json')).json<{
    paths: Record<string, unknown>;
  }>();
  expect(doc.paths['/api/v1/local-signer/heartbeat']).toBeDefined();
  expect(doc.paths['/api/v1/marking/commands/prepare']).toBeDefined();
  expect(doc.paths['/api/v1/marking/commands/simulate']).toBeUndefined();
});
