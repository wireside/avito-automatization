import { it, expect, vi } from 'vitest';
import { createAvitoActionProvider } from './avito-actions.js';
import type { MarketplaceOrder } from '@avito/domain';
const order = {
  id: '50000000000000001',
  marketplaceId: '70000000000000001',
} as MarketplaceOrder;
const auth = () =>
  new Response(
    JSON.stringify({ access_token: 'test-token', expires_in: 3600 }),
  );
function setup(responses: Response[]) {
  const f = vi.fn<typeof fetch>();
  for (const r of responses) f.mockResolvedValueOnce(r);
  return {
    f,
    provider: createAvitoActionProvider({
      clientId: 'id',
      clientSecret: 'secret',
      writesEnabled: true,
      fetch: f,
    }),
  };
}
it.each([
  [
    'confirm',
    {},
    '/order-management/1/order/applyTransition',
    { orderId: order.id, transition: 'confirm' },
  ],
  [
    'reject',
    {},
    '/order-management/1/order/applyTransition',
    { orderId: order.id, transition: 'reject' },
  ],
  [
    'perform',
    {},
    '/order-management/1/order/applyTransition',
    { orderId: order.id, transition: 'perform' },
  ],
  [
    'receive',
    {},
    '/order-management/1/order/applyTransition',
    { orderId: order.id, transition: 'receive' },
  ],
  [
    'setTrackNumber',
    { trackingNumber: '123' },
    '/order-management/1/order/setTrackingNumber',
    { orderId: order.id, trackingNumber: '123' },
  ],
  [
    'fixTrackNumber',
    { trackingNumber: '321' },
    '/order-management/1/order/setTrackingNumber',
    { orderId: order.id, trackingNumber: '321' },
  ],
  [
    'acceptReturnOrder',
    { terminalNumber: '123456', name: 'Test', phone: '+79999999999' },
    '/order-management/1/order/acceptReturnOrder',
    {
      orderId: order.id,
      terminalNumber: '123456',
      recipient: { name: 'Test', phone: '+79999999999' },
    },
  ],
  [
    'setCourierDeliveryRange',
    {
      address: 'Address',
      name: 'Test',
      phone: '+79999999999',
      startDate: '2026-11-10T10:00:00Z',
      endDate: '2026-11-10T12:00:00Z',
      intervalType: 'fixed',
    },
    '/order-management/1/order/setCourierDeliveryRange',
    {
      orderId: order.id,
      address: 'Address',
      name: 'Test',
      phone: '+79999999999',
      startDate: '2026-11-10T10:00:00Z',
      endDate: '2026-11-10T12:00:00Z',
      intervalType: 'fixed',
    },
  ],
] as const)(
  'maps %s to the official contract',
  async (action, data, path, body) => {
    const { f, provider } = setup([
      auth(),
      new Response(JSON.stringify({ success: true })),
    ]);
    const before = vi.fn().mockResolvedValue(undefined);
    await provider.execute(order, { requestId: 'r', action, data }, before);
    expect(f.mock.calls[1]?.[0]).toBe('https://api.avito.ru' + path);
    expect(JSON.parse(f.mock.calls[1]![1]!.body as string)).toEqual(body);
    expect(before).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[1]![1]!.redirect).toBe('error');
  },
);
it('uses marketplace IDs for labels, keeps taskID, downloads and validates PDF', async () => {
  const { f, provider } = setup([
    auth(),
    new Response(JSON.stringify({ taskID: 'task-id' })),
    new Response('%PDF-1.7\nfixture', {
      headers: { 'content-type': 'application/pdf' },
    }),
  ]);
  expect(
    await provider.execute(
      order,
      { requestId: 'r', action: 'label', data: {} },
      () => Promise.resolve(),
    ),
  ).toEqual({ labelTaskId: 'task-id' });
  expect(JSON.parse(f.mock.calls[1]![1]!.body as string)).toEqual({
    orderIDs: [order.marketplaceId],
  });
  expect(
    new TextDecoder().decode(await provider.download('task-id')),
  ).toContain('%PDF-');
});
it('requires business success rather than HTTP 200', async () => {
  const { provider } = setup([
    auth(),
    new Response(JSON.stringify({ success: false })),
  ]);
  await expect(
    provider.execute(
      order,
      { requestId: 'r', action: 'confirm', data: {} },
      () => Promise.resolve(),
    ),
  ).rejects.toMatchObject({ code: 'AVITO_ACTION_REJECTED', ambiguous: false });
});
it.each([500, 502, 503])(
  'marks HTTP %s mutation as unknown',
  async (status) => {
    const { provider } = setup([auth(), new Response('{}', { status })]);
    await expect(
      provider.execute(
        order,
        { requestId: 'r', action: 'confirm', data: {} },
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({
      code: 'AVITO_ACTION_RESULT_UNKNOWN',
      ambiguous: true,
    });
  },
);
it('does not follow redirects with credentials', async () => {
  const { provider } = setup([auth(), new Response('{}', { status: 302 })]);
  await expect(
    provider.execute(
      order,
      { requestId: 'r', action: 'confirm', data: {} },
      () => Promise.resolve(),
    ),
  ).rejects.toThrow();
});
it('refreshes OAuth exactly once on definite 401 without restarting the send barrier', async () => {
  const { f, provider } = setup([
    auth(),
    new Response('{}', { status: 401 }),
    auth(),
    new Response(JSON.stringify({ success: true })),
  ]);
  const before = vi.fn().mockResolvedValue(undefined);
  await provider.execute(
    order,
    { requestId: 'r', action: 'confirm', data: {} },
    before,
  );
  expect(f).toHaveBeenCalledTimes(4);
  expect(before).toHaveBeenCalledTimes(1);
});
it('keeps the flag fail-closed without acquiring token or sending', async () => {
  const f = vi.fn<typeof fetch>();
  const provider = createAvitoActionProvider({
    writesEnabled: false,
    fetch: f,
  });
  await expect(
    provider.execute(
      order,
      { requestId: 'r', action: 'confirm', data: {} },
      () => Promise.resolve(),
    ),
  ).rejects.toThrow('ORDER_ACTIONS_DISABLED');
  expect(f).not.toHaveBeenCalled();
});
it('returns pending for a label not generated yet and rejects non-PDF', async () => {
  for (const r of [
    new Response('{}', { status: 404 }),
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
  ]) {
    const { provider } = setup([auth(), r]);
    await expect(provider.download('task')).rejects.toThrow(
      'AVITO_LABEL_PENDING',
    );
  }
});
it('treats malformed 200 mutation result as ambiguous', async () => {
  const { provider } = setup([auth(), new Response('broken')]);
  await expect(
    provider.execute(
      order,
      { requestId: 'r', action: 'confirm', data: {} },
      () => Promise.resolve(),
    ),
  ).rejects.toMatchObject({ ambiguous: true });
});
