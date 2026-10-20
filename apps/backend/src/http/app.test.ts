import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type HttpServices } from './app.js';
import { apiErrorResponseSchema } from '@avito/contracts';
import type { DeliverTelegramUpdate } from './routes/telegram-webhook.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup(overrides: Partial<HttpServices> = {}) {
  const services: HttpServices = {
    verifyTelegramSession: vi
      .fn()
      .mockResolvedValue({ ok: false, code: 'USER_NOT_ALLOWED' }),
    checkReadiness: vi.fn().mockResolvedValue({ postgres: 'ok', redis: 'ok' }),
    ...overrides,
  };
  const app = await buildApp(
    {
      LOG_LEVEL: 'silent',
      MINI_APP_ORIGIN: 'https://app.example.com',
      TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    },
    services,
  );
  apps.push(app);
  return { app, services };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe('HTTP transport', () => {
  it('exposes the public OpenAPI document without authentication', async () => {
    const { app, services } = await setup();
    const response = await app.inject('/api/v1/openapi.json');
    expect(response.statusCode).toBe(200);
    const document = response.json<{
      openapi: string;
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    }>();
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/inventory',
        '/api/v1/inventory/variants/{id}/units',
        '/api/v1/inventory/receipts/scan',
        '/api/v1/auth/telegram/verify',
      ]),
    );
    expect(document.components.securitySchemes).toHaveProperty(
      'telegramInitData',
    );
    expect(services.verifyTelegramSession).not.toHaveBeenCalled();
  });
  it('supports a browser preflight and exposes the correlation header to the configured origin', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/inventory/receipts/scan',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
    expect(response.headers['access-control-allow-headers']).toMatch(
      /authorization/i,
    );
    const failed = await app.inject({
      url: '/api/v1/inventory',
      headers: { origin: 'https://app.example.com' },
    });
    expect(failed.headers['access-control-expose-headers']).toContain(
      'x-correlation-id',
    );
  });
  it('does not grant browser access to another origin', async () => {
    const { app } = await setup();
    const response = await app.inject({
      url: '/api/v1/openapi.json',
      headers: { origin: 'https://other.example.com' },
    });
    expect(response.headers['access-control-allow-origin']).not.toBe(
      'https://other.example.com',
    );
  });
  it('returns a correlated API error for unknown routes', async () => {
    const { app } = await setup();
    const response = await app.inject('/api/v1/not-found');
    expect(response.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
      requestId: response.headers['x-correlation-id'],
    });
  });
  it('validates requests before calling application code', async () => {
    const { app, services } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram/verify',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(services.verifyTelegramSession).not.toHaveBeenCalled();
  });
  it.each([
    ['INVALID_SIGNATURE', 401],
    ['USER_NOT_ALLOWED', 403],
    ['TELEGRAM_NOT_CONFIGURED', 503],
  ] as const)('maps %s to HTTP %s', async (code, status) => {
    const { app } = await setup({
      verifyTelegramSession: vi.fn().mockResolvedValue({ ok: false, code }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram/verify',
      payload: { initData: 'signed' },
    });
    expect(response.statusCode).toBe(status);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      ok: false,
      code,
      requestId: response.headers['x-correlation-id'],
    });
  });
  it('keeps the successful Mini App response contract', async () => {
    const user = {
      id: 'b0000000-0000-4000-8000-000000000001',
      telegramId: '42',
      displayName: null,
      roles: ['OWNER'],
    };
    const { app } = await setup({
      verifyTelegramSession: vi.fn().mockResolvedValue({ ok: true, user }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram/verify',
      payload: { initData: 'signed' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user });
    expect(response.headers['x-correlation-id']).toBeTruthy();
  });
  it('reports a dependency failure without changing liveness', async () => {
    const { app } = await setup({
      checkReadiness: vi
        .fn()
        .mockResolvedValue({ postgres: 'error', redis: 'ok' }),
    });
    expect((await app.inject('/health/ready')).statusCode).toBe(503);
    expect((await app.inject('/health/live')).statusCode).toBe(200);
  });
  it('rejects webhook requests before update delivery when secret is wrong', async () => {
    const deliverTelegramUpdate = vi
      .fn<DeliverTelegramUpdate>()
      .mockResolvedValue('delivered');
    const { app } = await setup({ deliverTelegramUpdate });
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      payload: { update_id: 1 },
    });
    expect(response.statusCode).toBe(401);
    expect(deliverTelegramUpdate).not.toHaveBeenCalled();
  });
  it.each([
    ['delivered', 204],
    ['duplicate', 204],
    ['processing', 503],
    ['failed', 502],
  ] as const)('maps webhook delivery %s to %s', async (result, status) => {
    const { app } = await setup({
      deliverTelegramUpdate: vi
        .fn<DeliverTelegramUpdate>()
        .mockResolvedValue(result),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/telegram',
      headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
      payload: { update_id: 1 },
    });
    expect(response.statusCode).toBe(status);
  });
});
