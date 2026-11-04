import { randomUUID } from 'node:crypto';
import { it, expect, afterEach, vi } from 'vitest';
import { createMarkingPipeline, type PipelineStore } from '@avito/domain';
import { buildApp } from '../app.js';
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(() => Promise.all(apps.splice(0).map((a) => a.close())));
async function setup(
  roles = ['OWNER'],
  mode: 'disabled' | 'simulation' = 'simulation',
) {
  const store = {
    execute: vi.fn().mockResolvedValue({
      ok: true,
      simulated: true,
      replayed: false,
      result: {},
    }),
    read: vi
      .fn()
      .mockResolvedValue({ mode, simulated: mode === 'simulation', data: [] }),
    run: vi.fn(),
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
      markingPipeline: createMarkingPipeline(store, mode),
    },
  );
  apps.push(app);
  return { app, store };
}
const headers = { authorization: 'tma signed' };
it('authenticates before commands and rejects unknown fields and malformed IDs', async () => {
  const { app, store } = await setup();
  const url = '/api/v1/marking/commands/check';
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
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/marking/units/not-uuid',
        headers,
      })
    ).statusCode,
  ).toBe(400);
  expect(store.execute).not.toHaveBeenCalled();
});
it('keeps VIEWER read-only and restricts irreversible commands to administrators', async () => {
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
  expect(store.execute).not.toHaveBeenCalled();
});
it('defaults to no external mutations and exposes mode explicitly', async () => {
  const { app, store } = await setup(['OWNER'], 'disabled');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/marking/commands/check',
        headers,
        payload: { requestId: randomUUID(), unitId: randomUUID() },
      })
    ).statusCode,
  ).toBe(503);
  const r = await app.inject({
    method: 'GET',
    url: '/api/v1/marking/overview',
    headers,
  });
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.json()).toMatchObject({ mode: 'disabled', simulated: false });
  expect(store.execute).not.toHaveBeenCalled();
});
it('publishes schemas for all commands and bounded reads', async () => {
  const { app } = await setup();
  const r = await app.inject('/api/v1/openapi.json');
  const doc = r.json<{ paths: Record<string, unknown> }>();
  expect(doc.paths['/api/v1/marking/commands/prepare']).toBeDefined();
  expect(doc.paths['/api/v1/marking/units/{id}']).toBeDefined();
});
