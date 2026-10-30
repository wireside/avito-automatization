import { describe, expect, it, vi } from 'vitest';
import { createAvitoOrderReader } from './avito-orders.js';
const order = {
  id: '50000000000000001',
  status: 'on_confirmation',
  createdAt: '2026-10-30T10:00:00Z',
  updatedAt: '2026-10-30T10:00:00Z',
  items: [
    { avitoId: '123', title: 'Джинсы', count: 2, prices: { price: 1500.25 } },
  ],
  prices: { price: 3000.5 },
  schedules: { confirmTill: '2026-10-31T10:00:00Z' },
  delivery: {
    trackingNumber: 'TRACK-TEST',
    serviceName: 'Служба доставки',
    buyerInfo: { fullName: 'PRIVATE BUYER', phone: 'PRIVATE PHONE' },
  },
  availableActions: [{ name: 'confirm', required: true }],
};
const token = () =>
  new Response(
    JSON.stringify({
      access_token: 'private-token',
      expires_in: 3600,
      token_type: 'Bearer',
    }),
  );
function setup(responses: Response[]) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() => Promise.resolve(responses.shift()!));
  const reader = createAvitoOrderReader({
    clientId: 'private-id',
    clientSecret: 'private-secret',
    fetch,
    acquireReadSlot: () => Promise.resolve(true),
  });
  return { reader, fetch };
}
const page = (orders = [order]) =>
  new Response(JSON.stringify({ orders, hasMore: false }));
describe('Avito order observation', () => {
  it('uses only token POST and order GET, preserves long IDs, strips personal data and normalizes amounts', async () => {
    const { reader, fetch } = setup([token(), page(), page()]);
    const result = await reader.list({
      page: 2,
      limit: 10,
      status: 'on_confirmation',
    });
    expect(result).toMatchObject({
      ok: true,
      mode: 'read_only',
      orders: [
        { id: order.id, priceMinor: 300050, items: [{ priceMinor: 150025 }] },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|private-token|private-secret|buyerInfo/,
    );
    expect(await reader.get(order.id)).toMatchObject({
      ok: true,
      order: { delivery: { trackingNumber: 'TRACK-TEST' } },
    });
    expect(
      fetch.mock.calls.map(([url, init]) => [
        (typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.href
            : url.url
        ).split('?')[0],
        init?.method,
      ]),
    ).toEqual([
      ['https://api.avito.ru/token', 'POST'],
      ['https://api.avito.ru/order-management/1/orders', 'GET'],
      ['https://api.avito.ru/order-management/1/orders', 'GET'],
    ]);
    const listUrl = new URL(fetch.mock.calls[1]![0]);
    expect(listUrl.searchParams.get('statuses')).toBe('on_confirmation');
    expect(listUrl.searchParams.get('page')).toBe('2');
    expect(new URL(fetch.mock.calls[2]![0]).searchParams.get('ids')).toBe(
      order.id,
    );
  });
  it('refreshes token once on 401 and then stops', async () => {
    const { reader, fetch } = setup([
      token(),
      new Response('', { status: 401 }),
      token(),
      new Response('', { status: 401 }),
    ]);
    expect(await reader.list({ page: 1, limit: 20 })).toEqual({
      ok: false,
      code: 'AVITO_ACCESS_DENIED',
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('honors provider cooldown without another provider call', async () => {
    const { reader, fetch } = setup([
      token(),
      new Response('', { status: 429, headers: { 'retry-after': '60' } }),
    ]);
    expect(await reader.list({ page: 1, limit: 20 })).toEqual({
      ok: false,
      code: 'AVITO_RATE_LIMITED',
    });
    expect(await reader.get(order.id)).toEqual({
      ok: false,
      code: 'AVITO_RATE_LIMITED',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects malformed provider payload and safely contains network failures', async () => {
    const { reader } = setup([
      token(),
      new Response('{"orders":[{"id":9007199254740999}],"hasMore":false}'),
    ]);
    expect(await reader.list({ page: 1, limit: 20 })).toEqual({
      ok: false,
      code: 'AVITO_UNAVAILABLE',
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('secret provider response'));
    expect(
      await createAvitoOrderReader({
        clientId: 'id',
        clientSecret: 'secret',
        fetch,
      }).list({ page: 1, limit: 20 }),
    ).toEqual({ ok: false, code: 'AVITO_UNAVAILABLE' });
  });
  it('does not request without credentials or a shared read slot', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      await createAvitoOrderReader({
        clientId: undefined,
        clientSecret: undefined,
        fetch,
      }).list({ page: 1, limit: 20 }),
    ).toEqual({ ok: false, code: 'AVITO_NOT_CONFIGURED' });
    expect(
      await createAvitoOrderReader({
        clientId: 'id',
        clientSecret: 'secret',
        fetch,
        acquireReadSlot: () => Promise.resolve(false),
      }).get(order.id),
    ).toEqual({ ok: false, code: 'AVITO_RATE_LIMITED' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not substitute a different order or reject future unknown statuses', async () => {
    const { reader } = setup([
      token(),
      page([{ ...order, status: 'future_status' }]),
      page(),
    ]);
    expect(await reader.list({ page: 1, limit: 20 })).toMatchObject({
      orders: [{ status: 'future_status' }],
    });
    expect(await reader.get('123456')).toEqual({
      ok: false,
      code: 'ORDER_NOT_FOUND',
    });
  });
});

const photoUrl = 'https://01.img.avito.st/image/sanitized-fixture.jpg';
const photoOrder = {
  ...order,
  items: [{ ...order.items[0]!, chatId: 'sanitized-chat' }],
};
const self = () => new Response(JSON.stringify({ id: 42 }));
const chat = (id = '123', url = photoUrl) =>
  new Response(
    JSON.stringify({
      context: {
        type: 'item',
        value: { id, images: { main: { '140x105': url }, count: 1 } },
      },
      users: [{ name: 'PRIVATE BUYER', phone: 'PRIVATE PHONE' }],
      last_message: { text: 'PRIVATE MESSAGE' },
    }),
  );
describe('listing photo enrichment', () => {
  it('reads the linked item photo, caches it, and never exposes chat or personal data', async () => {
    const { reader, fetch } = setup([
      token(),
      page([photoOrder]),
      self(),
      chat(),
      page([photoOrder]),
    ]);
    const first = await reader.list({ page: 1, limit: 20 });
    expect(first).toMatchObject({
      orders: [{ items: [{ imageUrl: photoUrl }] }],
    });
    expect(JSON.stringify(first)).not.toMatch(
      /PRIVATE|sanitized-chat|last_message|users/,
    );
    expect(await reader.get(order.id)).toMatchObject({
      order: { items: [{ imageUrl: photoUrl }] },
    });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls[3]![0]).toEqual(
      expect.stringContaining('/messenger/v2/accounts/42/chats/sanitized-chat'),
    );
  });
  it('keeps orders readable when Messenger access is denied', async () => {
    const { reader } = setup([
      token(),
      page([photoOrder]),
      self(),
      new Response('', { status: 403 }),
    ]);
    expect(await reader.list({ page: 1, limit: 20 })).toMatchObject({
      ok: true,
      orders: [{ items: [{ imageUrl: null }] }],
    });
  });
  it.each([
    ['different listing', '456', photoUrl],
    ['untrusted host', '123', 'https://attacker.example/photo.jpg'],
    ['insecure URL', '123', 'http://01.img.avito.st/photo.jpg'],
    ['embedded credentials', '123', 'https://secret@01.img.avito.st/photo.jpg'],
  ])('does not use a photo with %s', async (_label, id, url) => {
    const { reader } = setup([
      token(),
      page([photoOrder]),
      self(),
      chat(id, url),
    ]);
    expect(await reader.list({ page: 1, limit: 20 })).toMatchObject({
      orders: [{ items: [{ imageUrl: null }] }],
    });
  });
});
