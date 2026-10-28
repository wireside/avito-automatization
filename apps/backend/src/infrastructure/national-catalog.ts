import {
  resolveReceiptCatalog,
  normalizeCatalogGtin,
  type CatalogLookupResult,
} from '@avito/domain';
import { z } from 'zod';
import type { ReadableStreamDefaultReader } from 'node:stream/web';

const label = z.string().max(2000);
const responseSchema = z.object({
  result: z
    .array(
      z.object({
        good_id: z.union([z.number().int().nonnegative(), z.string().max(64)]),
        good_name: label.nullish(),
        good_status: z.string().max(100),
        identified_by: z
          .array(
            z.object({
              value: z.string().max(64),
              type: z.string().max(64),
              level: z.string().max(64),
            }),
          )
          .max(100),
        good_attrs: z
          .array(
            z.object({
              attr_id: z.number().int(),
              attr_name: label,
              attr_value: label,
              attr_value_type: label.nullish(),
            }),
          )
          .max(2000)
          .default([]),
      }),
    )
    .max(25),
});

async function readBody(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Missing catalog response');
  const reader =
    response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2_000_000) throw new Error('Catalog response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function createNationalCatalogLookup(options: {
  apiKey?: string;
  environment: 'production' | 'sandbox';
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}) {
  const fetchCatalog = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<
    string,
    { result: CatalogLookupResult; until: number }
  >();
  const pending = new Map<string, Promise<CatalogLookupResult>>();
  let unavailableUntil = 0;
  async function request(gtin: string): Promise<CatalogLookupResult> {
    const url = new URL(
      '/v3/product',
      options.environment === 'sandbox'
        ? 'https://api.nk.sandbox.crptech.ru'
        : 'https://апи.национальный-каталог.рф',
    );
    url.searchParams.set('apikey', options.apiKey!);
    url.searchParams.set('gtin', gtin);
    url.searchParams.set('format', 'json');
    try {
      const response = await fetchCatalog(url, {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const seconds =
          retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 60;
        unavailableUntil = now() + Math.max(1, seconds) * 1000;
      } else if ([401, 403].includes(response.status)) {
        unavailableUntil = now() + 60_000;
      }
      for (const header of ['api-usage-limit', 'api-method-usage-limit']) {
        const usage = /^(\d+)\/(\d+)$/.exec(response.headers.get(header) ?? '');
        if (usage && Number(usage[1]) >= Number(usage[2]))
          unavailableUntil = Math.max(unavailableUntil, now() + 300_000);
      }
      if (!response.ok) {
        await response.body?.cancel();
        return {
          status: response.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE',
        };
      }
      const parsed = responseSchema.safeParse(await readBody(response));
      if (!parsed.success) return { status: 'UNAVAILABLE' };
      return resolveReceiptCatalog(
        gtin,
        parsed.data.result.map((card) => ({
          sourceReference: `national-catalog:${card.good_id}`,
          name: card.good_name ?? null,
          status: card.good_status,
          identifiers: card.identified_by,
          attributes: card.good_attrs.map((attribute) => ({
            id: attribute.attr_id,
            name: attribute.attr_name,
            value: attribute.attr_value,
            valueType: attribute.attr_value_type ?? null,
          })),
        })),
        new Date(now()).toISOString(),
      );
    } catch {
      unavailableUntil = Math.max(unavailableUntil, now() + 5000);
      return { status: 'UNAVAILABLE' };
    }
  }
  return (gtin: string): Promise<CatalogLookupResult> => {
    if (!options.apiKey) return Promise.resolve({ status: 'NOT_CONFIGURED' });
    if (normalizeCatalogGtin(gtin) !== gtin)
      return Promise.resolve({ status: 'NOT_FOUND' });
    const cached = cache.get(gtin);
    if (cached && cached.until > now()) return Promise.resolve(cached.result);
    const existing = pending.get(gtin);
    if (existing) return existing;
    if (now() < unavailableUntil || pending.size >= 4)
      return Promise.resolve({ status: 'UNAVAILABLE' });
    const task = request(gtin)
      .then((result) => {
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(gtin, {
          result,
          until: now() + (result.status === 'FOUND' ? 300_000 : 15_000),
        });
        return result;
      })
      .finally(() => pending.delete(gtin));
    pending.set(gtin, task);
    return task;
  };
}
