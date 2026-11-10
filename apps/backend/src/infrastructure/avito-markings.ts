import { z } from 'zod';
import {
  ProviderError,
  type MarkingWork,
  type MarketplaceOrder,
} from '@avito/domain';
export function createAvitoMarkingSender(options: {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  writesEnabled: boolean;
  acquireSlot?: () => Promise<boolean>;
  readOrder?: (id: string) => Promise<MarketplaceOrder>;
  fetch?: typeof fetch;
}) {
  const fetcher = options.fetch ?? fetch;
  let token: string | undefined,
    expiresAt = 0,
    cooldownUntil = 0;
  async function getToken() {
    if (token && expiresAt > Date.now()) return token;
    let r: Response;
    try {
      r = await fetcher('https://api.avito.ru/token', {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: options.clientId!,
          client_secret: options.clientSecret!,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ProviderError('AVITO_UNAVAILABLE', true);
    }
    if (!r.ok)
      throw new ProviderError(
        'AVITO_AUTH_FAILED',
        r.status === 429 || r.status >= 500,
      );
    const data = z
      .object({
        access_token: z.string().min(1),
        expires_in: z.number().positive(),
        token_type: z.string().optional(),
      })
      .safeParse(await r.json().catch(() => null));
    if (
      !data.success ||
      (data.data.token_type && data.data.token_type.toLowerCase() !== 'bearer')
    )
      throw new ProviderError('AVITO_AUTH_FAILED');
    token = data.data.access_token;
    expiresAt = Date.now() + Math.max(0, data.data.expires_in - 60) * 1000;
    return token;
  }
  return async (work: Extract<MarkingWork, { kind: 'markings' }>) => {
    if (!options.writesEnabled)
      throw new ProviderError('AVITO_WRITES_DISABLED', true);
    if (!options.clientId || !options.clientSecret)
      throw new ProviderError('AVITO_NOT_CONFIGURED');
    const codes = work.items.flatMap((i) => i.markings);
    if (
      work.items.length < 1 ||
      work.items.length > 50 ||
      new Set(work.items.map((i) => i.avitoId)).size !== work.items.length ||
      new Set(codes).size !== codes.length ||
      work.items.some(
        (i) =>
          i.markings.length < 1 ||
          i.markings.length > 10 ||
          i.markings.some((c) => c.length < 29 || c.length > 129),
      )
    )
      throw new ProviderError('INVALID_MARKING_BATCH');
    if (options.readOrder) {
      const order = await options.readOrder(work.externalOrderId);
      if (
        order.id !== work.externalOrderId ||
        !['on_confirmation', 'ready_to_ship'].includes(order.status) ||
        !order.availableActions.some((a) => a.name === 'setMarkings') ||
        order.items.length !== work.items.length ||
        !work.items.every((i) =>
          order.items.some(
            (o) => o.avitoId === i.avitoId && o.quantity === i.markings.length,
          ),
        )
      )
        throw new ProviderError('ORDER_COMPOSITION_CHANGED');
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (
        cooldownUntil > Date.now() ||
        (options.acquireSlot && !(await options.acquireSlot()))
      )
        throw new ProviderError('AVITO_RATE_LIMITED', true);
      const access = await getToken();
      let r: Response;
      try {
        r = await fetcher('https://api.avito.ru/order-management/1/markings', {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: 'Bearer ' + access,
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
      if (r.status === 401 && attempt === 0) {
        token = undefined;
        continue;
      }
      if (!r.ok) {
        if (r.status === 429) {
          const retry = r.headers.get('retry-after');
          const delay =
            retry && /^\d+$/.test(retry)
              ? Number(retry) * 1000
              : retry
                ? Date.parse(retry) - Date.now()
                : 60000;
          cooldownUntil =
            Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 60000);
        }
        throw new ProviderError(
          'AVITO_MARKINGS_HTTP_' + r.status,
          r.status === 429,
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
              error: z.string().nullish(),
            }),
          ),
        })
        .safeParse(await r.json().catch(() => null));
      if (!result.success)
        throw new ProviderError('AVITO_MARKINGS_RESULT_UNKNOWN', false, true);
      if (
        result.data.results.length !== work.items.length ||
        !work.items.every((i) => {
          const matches = result.data.results.filter(
            (v) => v.orderId === work.externalOrderId && v.itemId === i.avitoId,
          );
          return (
            matches.length === 1 && matches[0]!.success && !matches[0]!.error
          );
        })
      )
        throw new ProviderError('AVITO_MARKINGS_NOT_CONFIRMED');
      return;
    }
    throw new ProviderError('AVITO_AUTH_FAILED');
  };
}
