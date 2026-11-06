import { it, expect, vi } from 'vitest';
import { createTrueApiClient } from './true-api.js';
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
it('uses attached-signed challenge for UUID session authorization', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({ uuid: 'challenge', data: 'exact\nbytes' }),
    )
    .mockResolvedValueOnce(
      response({
        uuidToken: 'session-token',
        expireDate: '2027-01-01T00:00:00Z',
      }),
    );
  const api = createTrueApiClient({
    session: {
      getToken: () => Promise.resolve(null),
      invalidate: () => Promise.resolve(),
    },
    fetch: fetcher,
  });
  expect(await api.challenge()).toEqual({
    uuid: 'challenge',
    data: 'exact\nbytes',
  });
  expect(
    await api.authenticate('challenge', 'cms-attached', '123456789012'),
  ).toMatchObject({ token: 'session-token' });
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
    uuid: 'challenge',
    data: 'cms-attached',
    inn: '123456789012',
    unitedToken: true,
  });
});
it('has no network call without a session or explicit document-submission permission', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const api = createTrueApiClient({
    session: {
      getToken: () => Promise.resolve(null),
      invalidate: () => Promise.resolve(),
    },
    fetch: fetcher,
  });
  await expect(api.check(['cis'])).rejects.toThrow('CHZ_AUTH_REQUIRED');
  await expect(
    api.submit({
      type: 'LK_RECEIPT',
      payloadBase64: 'e30=',
      signatureBase64: 'sig',
    }),
  ).rejects.toThrow('DOCUMENT_SUBMISSION_DISABLED');
  expect(fetcher).not.toHaveBeenCalled();
});
it('maps per-code observations and invalidates an unauthorized session', async () => {
  const invalidate = vi.fn(),
    fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([
          {
            cisInfo: {
              cis: 'cis',
              status: 'INTRODUCED',
              statusEx: 'EMPTY',
              ownerInn: '123',
            },
          },
        ]),
      )
      .mockResolvedValueOnce(response({}, 401));
  const api = createTrueApiClient({
    session: { getToken: () => Promise.resolve('token'), invalidate },
    fetch: fetcher,
  });
  expect(await api.check(['cis'])).toEqual([
    expect.objectContaining({
      cis: 'cis',
      status: 'INTRODUCED',
      ownerInn: '123',
    }),
  ]);
  await expect(api.check(['cis'])).rejects.toThrow('CHZ_AUTH_REQUIRED');
  expect(invalidate).toHaveBeenCalledOnce();
});
it('does not accept a different document and never blindly retries a timed-out submission', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response([
        { number: 'other', status: 'CHECKED_OK', type: 'LK_RECEIPT', body: {} },
      ]),
    )
    .mockRejectedValueOnce(new Error('sensitive details'));
  const api = createTrueApiClient({
    session: {
      getToken: () => Promise.resolve('token'),
      invalidate: () => Promise.resolve(),
    },
    fetch: fetcher,
    submissionsEnabled: true,
  });
  await expect(api.document('expected')).rejects.toThrow(
    'CHZ_DOCUMENT_RESPONSE_MISMATCH',
  );
  await expect(
    api.submit({
      type: 'LK_RECEIPT',
      payloadBase64: 'e30=',
      signatureBase64: 'sig',
    }),
  ).rejects.toMatchObject({
    code: 'SUBMISSION_RESULT_UNKNOWN',
    ambiguous: true,
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('reads the complete structured UPD across provider pages', async () => {
  const products = Array.from({ length: 1000 }, (_, i) => ({
    code: 'code-' + i,
    codeType: 'EXEMPLARY',
    strNum: 1,
  }));
  const base = {
    number: 'upd',
    status: 'CHECKED_OK',
    senderInn: 'supplier',
    receiverInn: 'seller',
    type: 'UNIVERSAL_TRANSFER_DOCUMENT',
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response([{ ...base, body: { products, productsTotal: 1001 } }]),
    )
    .mockResolvedValueOnce(
      response([
        {
          ...base,
          body: {
            products: [{ code: 'last-code', codeType: 'EXEMPLARY', strNum: 2 }],
            productsTotal: 1001,
          },
        },
      ]),
    );
  const api = createTrueApiClient({
    session: {
      getToken: () => Promise.resolve('session'),
      invalidate: () => Promise.resolve(),
    },
    fetch: fetcher,
  });
  const doc = await api.document('upd');
  expect(doc.body).toMatchObject({ productsTotal: 1001 });
  expect(
    (doc.body as { products: { code: string }[] }).products.some(
      (p) => p.code === 'last-code',
    ),
  ).toBe(true);
  expect(fetcher.mock.calls[1]![0]).toContain('pageNumber=2');
});
