import { z } from 'zod';
import { ProviderError, type MarkingWork } from '@avito/domain';
export function createAvitoMarkingSender(options: {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  writesEnabled: boolean;
  acquireSlot?: () => Promise<boolean>;
  fetch?: typeof fetch;
}) {
  const fetcher = options.fetch ?? fetch;
  let token: string | undefined,
    expiresAt = 0;
  return async (work: Extract<MarkingWork, { kind: 'markings' }>) => {
    if (!options.writesEnabled)
      throw new ProviderError('AVITO_WRITES_DISABLED', true);
    if (!options.clientId || !options.clientSecret)
      throw new ProviderError('AVITO_NOT_CONFIGURED');
    if (options.acquireSlot && !(await options.acquireSlot()))
      throw new ProviderError('AVITO_RATE_LIMITED', true);
    if (!token || expiresAt < Date.now()) {
      const r = await fetcher('https://api.avito.ru/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: options.clientId,
          client_secret: options.clientSecret,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new ProviderError('AVITO_AUTH_FAILED');
      const data = z
        .object({
          access_token: z.string().min(1),
          expires_in: z.number().positive(),
        })
        .parse(await r.json());
      token = data.access_token;
      expiresAt = Date.now() + (data.expires_in - 60) * 1000;
    }
    if (
      work.items.length < 1 ||
      work.items.length > 50 ||
      new Set(work.items.map((i) => i.avitoId)).size !== work.items.length ||
      work.items.some(
        (i) =>
          i.markings.length < 1 ||
          i.markings.length > 10 ||
          i.markings.some((c) => c.length < 29 || c.length > 129),
      )
    )
      throw new ProviderError('INVALID_MARKING_BATCH');
    // Full current composition, serialized per order by the durable worker.
    let r: Response;
    try {
      r = await fetcher('https://api.avito.ru/order-management/1/markings', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          markings: work.items.map((i) => ({
            orderId: work.externalOrderId,
            itemId: i.avitoId,
            markings: i.markings,
          })),
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ProviderError('AVITO_MARKINGS_RESULT_UNKNOWN', false, true);
    }
    if (!r.ok) {
      if (r.status === 401) token = undefined;
      throw new ProviderError(
        'AVITO_MARKINGS_HTTP_' + r.status,
        r.status === 401 || r.status === 429,
        r.status >= 500,
      );
    }
    const result = z
      .object({
        results: z.array(
          z.object({
            orderId: z.string(),
            itemId: z.string(),
            success: z.boolean(),
            error: z.unknown().optional(),
          }),
        ),
      })
      .safeParse(await r.json());
    if (
      !result.success ||
      !work.items.every((i) =>
        result.data.results.some(
          (v) =>
            v.orderId === work.externalOrderId &&
            v.itemId === i.avitoId &&
            v.success,
        ),
      )
    )
      throw new ProviderError('AVITO_MARKINGS_NOT_CONFIRMED');
  };
}
