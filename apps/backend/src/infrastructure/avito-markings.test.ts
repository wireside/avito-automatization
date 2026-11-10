import { it, expect, vi } from 'vitest';
import { createAvitoMarkingSender } from './avito-markings.js';
const work = {
  kind: 'markings' as const,
  shipmentId: 's',
  externalOrderId: '50000000000000001',
  items: [{ avitoId: '123', markings: ['010466043076454321TEST000000001'] }],
};
it('does not call the real API when writes are not enabled', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    createAvitoMarkingSender({ writesEnabled: false, fetch: fetcher })(work),
  ).rejects.toThrow('AVITO_WRITES_DISABLED');
  expect(fetcher).not.toHaveBeenCalled();
});
it('uses the official full-list marking contract and checks every result', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 })),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              orderId: work.externalOrderId,
              itemId: '123',
              success: true,
              error: null,
            },
          ],
        }),
      ),
    );
  const send = createAvitoMarkingSender({
    clientId: 'id',
    clientSecret: 'secret',
    writesEnabled: true,
    fetch: fetcher,
  });
  await send(work);
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
    markings: [
      {
        orderId: work.externalOrderId,
        itemId: '123',
        markings: work.items[0]!.markings,
      },
    ],
  });
});
it('treats missing item confirmation as failure even for HTTP 200', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
  await expect(
    createAvitoMarkingSender({
      clientId: 'id',
      clientSecret: 'secret',
      writesEnabled: true,
      fetch: fetcher,
    })(work),
  ).rejects.toThrow('AVITO_MARKINGS_NOT_CONFIRMED');
});

it('refreshes the token once for 401 and requires one confirmation for each item', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'old', expires_in: 3600 })),
    )
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 })),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            { orderId: work.externalOrderId, itemId: '123', success: true },
          ],
        }),
      ),
    );
  await createAvitoMarkingSender({
    clientId: 'id',
    clientSecret: 'secret',
    writesEnabled: true,
    fetch: fetcher,
  })(work);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.every((c) => c[1]!.redirect === 'error')).toBe(
    true,
  );
});
it('rejects duplicate confirmations instead of accepting a partial batch', async () => {
  const row = { orderId: work.externalOrderId, itemId: '123', success: true };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 })),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [row, row] })),
    );
  await expect(
    createAvitoMarkingSender({
      clientId: 'id',
      clientSecret: 'secret',
      writesEnabled: true,
      fetch: fetcher,
    })(work),
  ).rejects.toThrow('AVITO_MARKINGS_NOT_CONFIRMED');
});
it('checks a fresh provider order before acquiring token or sending codes', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const readOrder = vi.fn().mockResolvedValue({
    id: work.externalOrderId,
    status: 'canceled',
    availableActions: [],
    items: [],
  });
  await expect(
    createAvitoMarkingSender({
      clientId: 'id',
      clientSecret: 'secret',
      writesEnabled: true,
      fetch: fetcher,
      readOrder,
    })(work),
  ).rejects.toThrow('ORDER_COMPOSITION_CHANGED');
  expect(fetcher).not.toHaveBeenCalled();
});
