import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadOrders, type OrderReader } from '@avito/domain';
import { ordersPageResponseSchema } from '@avito/contracts';
import { buildApp } from '../app.js';
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function setup(roles = ['OWNER']) {
  const list = vi.fn<OrderReader['list']>().mockResolvedValue({
    ok: true,
    orders: [],
    hasMore: false,
    fetchedAt: new Date().toISOString(),
    mode: 'read_only',
  });
  const get = vi
    .fn<OrderReader['get']>()
    .mockResolvedValue({ ok: false, code: 'ORDER_NOT_FOUND' });
  const app = await buildApp(
    {
      LOG_LEVEL: 'silent',
      MINI_APP_ORIGIN: 'https://app.example.com',
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
            roles,
          },
        }),
      checkReadiness: () => Promise.resolve({ postgres: 'ok', redis: 'ok' }),
      readOrders: createReadOrders({ list, get }),
    },
  );
  apps.push(app);
  return { app, list, get };
}
const headers = { authorization: 'tma signed' };
describe('order HTTP API read-only boundary', () => {
  it('requires authentication before fetching Avito', async () => {
    const { app, list } = await setup();
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/orders' })).statusCode,
    ).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });
  it('validates query and IDs and returns the shared contract', async () => {
    const { app, list } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orders?status=in_transit&page=2',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(ordersPageResponseSchema.safeParse(response.json()).success).toBe(
      true,
    );
    expect(list).toHaveBeenCalledWith({
      status: 'in_transit',
      page: 2,
      limit: 20,
    });
    for (const url of [
      '/api/v1/orders?limit=21',
      '/api/v1/orders?status=packed',
      '/api/v1/orders?unknown=x',
      '/api/v1/orders/not-numeric',
    ]) {
      expect(
        (await app.inject({ method: 'GET', url, headers })).statusCode,
      ).toBe(400);
    }
  });
  it('reads one order and returns not found without inventing a local state', async () => {
    const { app, get } = await setup();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/orders/50000000000000001',
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(get).toHaveBeenCalledWith('50000000000000001');
  });
  it.each(['OWNER', 'ADMIN', 'WAREHOUSE'])(
    'blocks confirmation for %s without ANY provider call',
    async (role) => {
      const { app, list, get } = await setup([role]);
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/orders/123/confirm',
        headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        ok: false,
        code: 'ORDER_ACTIONS_DISABLED',
      });
      expect(list).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );
  it.each(['VIEWER', 'ACCOUNTANT', 'OTHER'])(
    'does not grant confirmation to %s',
    async (role) => {
      const { app, list } = await setup([role]);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/orders/123/confirm',
            headers,
          })
        ).statusCode,
      ).toBe(403);
      if (role === 'OTHER')
        expect(
          (await app.inject({ method: 'GET', url: '/api/v1/orders', headers }))
            .statusCode,
        ).toBe(403);
      expect(list).not.toHaveBeenCalled();
    },
  );
});
