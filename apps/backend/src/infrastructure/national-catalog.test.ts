import { describe, expect, it, vi } from 'vitest';
import { createNationalCatalogLookup } from './national-catalog.js';
const gtin = '04660430764543';
const card = {
  good_id: 123,
  good_name: 'Брюки арт. ZZ-8 белые XL',
  good_status: 'published',
  identified_by: [
    { value: gtin.slice(1), type: 'gtin', level: 'trade-unit', multiplier: 1 },
  ],
  good_attrs: [
    {
      attr_id: 13914,
      attr_name: 'Модель / артикул производителя',
      attr_value: 'ZZ-8',
    },
    { attr_id: 36, attr_name: 'Цвет', attr_value: 'белый' },
    {
      attr_id: 35,
      attr_name: 'Размер одежды / изделия',
      attr_value: 'XL',
      attr_value_type: 'ЕВРОПА',
    },
  ],
};
const response = (cards = [card]) =>
  new Response(JSON.stringify({ apiversion: 3, result: cards }));
describe('read-only National Catalog adapter', () => {
  it('sends only a GTIN to a fixed host, keeps credentials server-side, deduplicates and caches', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(response()));
    const lookup = createNationalCatalogLookup({
      apiKey: 'test-private-key',
      environment: 'production',
      timeoutMs: 500,
      fetch,
    });
    const [first, second] = await Promise.all([lookup(gtin), lookup(gtin)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: 'FOUND',
      product: { article: 'ZZ-8', size: 'XL', color: 'белый' },
    });
    expect(JSON.stringify(first)).not.toContain('test-private-key');
    await lookup(gtin);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).searchParams.get('gtin')).toBe(gtin);
    expect([...(url as URL).searchParams.keys()].sort()).toEqual([
      'apikey',
      'format',
      'gtin',
    ]);
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json' },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not request anything without a key or for invalid GTINs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      await createNationalCatalogLookup({
        environment: 'sandbox',
        timeoutMs: 500,
        fetch,
      })(gtin),
    ).toEqual({ status: 'NOT_CONFIGURED' });
    expect(
      await createNationalCatalogLookup({
        apiKey: 'test',
        environment: 'sandbox',
        timeoutMs: 500,
        fetch,
      })('invalid'),
    ).toEqual({ status: 'NOT_FOUND' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses malformed responses and mismatches instead of accepting the first card', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{bad-json'))
      .mockResolvedValueOnce(response());
    let now = 0;
    const lookup = createNationalCatalogLookup({
      apiKey: 'test',
      environment: 'sandbox',
      timeoutMs: 500,
      fetch,
      now: () => now,
    });
    expect(await lookup(gtin)).toEqual({ status: 'UNAVAILABLE' });
    now = 16_000;
    expect(await lookup('04660430764550')).toEqual({ status: 'NOT_FOUND' });
    expect((fetch.mock.calls[0]![0] as URL).origin).toBe(
      'https://api.nk.sandbox.crptech.ru',
    );
  });
  it('respects 429 Retry-After across different GTINs without retrying inline', async () => {
    let now = 0;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'retry-after': '600' } }),
      )
      .mockImplementation(() => Promise.resolve(response()));
    const lookup = createNationalCatalogLookup({
      apiKey: 'test',
      environment: 'sandbox',
      timeoutMs: 500,
      fetch,
      now: () => now,
    });
    expect(await lookup(gtin)).toEqual({ status: 'UNAVAILABLE' });
    expect(await lookup('04660430764550')).toEqual({ status: 'UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 301_000;
    expect(await lookup('04660430764550')).toEqual({ status: 'UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 601_000;
    expect((await lookup(gtin)).status).toBe('FOUND');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('handles exhausted quota, authorization failure and timeouts without leaking an exception', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ result: [card] }), {
        headers: { 'api-method-usage-limit': '100/100' },
      }),
    );
    const lookup = createNationalCatalogLookup({
      apiKey: 'test',
      environment: 'sandbox',
      timeoutMs: 500,
      fetch,
    });
    expect((await lookup(gtin)).status).toBe('FOUND');
    expect(await lookup('04660430764550')).toEqual({ status: 'UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const failure of [
      new Response('', { status: 401 }),
      new Response('', { status: 503 }),
    ]) {
      const failedFetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(failure);
      expect(
        await createNationalCatalogLookup({
          apiKey: 'test',
          environment: 'production',
          timeoutMs: 500,
          fetch: failedFetch,
        })(gtin),
      ).toEqual({ status: 'UNAVAILABLE' });
    }
    const rejected = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('url?apikey=secret'));
    expect(
      await createNationalCatalogLookup({
        apiKey: 'test',
        environment: 'production',
        timeoutMs: 500,
        fetch: rejected,
      })(gtin),
    ).toEqual({ status: 'UNAVAILABLE' });
  });
  it('rejects oversized bodies and partial HTTP-200 error envelopes', async () => {
    for (const body of [
      'x'.repeat(2_000_001),
      JSON.stringify({ error: 'provider error' }),
    ]) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(body));
      expect(
        await createNationalCatalogLookup({
          apiKey: 'test',
          environment: 'sandbox',
          timeoutMs: 500,
          fetch,
        })(gtin),
      ).toEqual({ status: 'UNAVAILABLE' });
    }
  });
});
