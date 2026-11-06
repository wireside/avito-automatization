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
