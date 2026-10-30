import { z } from 'zod';
import type {
  MarketplaceOrder,
  OrderQuery,
  OrderReader,
  OrdersFailure,
} from '@avito/domain';

// Official contracts: docs/openapi/avito/{auth,order-management,user}.openapi.json.
// Photo subset: docs/openapi/avito/messenger-photo.openapi.json. Read-only calls only.
const text = z.string().nullish();
const prices = z.object({
  price: z.number().finite().nonnegative().optional(),
});
const orderSchema = z.object({
  id: z.string().regex(/^[0-9]{1,32}$/),
  marketplaceId: text,
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(
    z.object({
      avitoId: z.string(),
      chatId: z.string().max(200).nullish(),
      title: z.string(),
      count: z.number().int().positive(),
      prices,
    }),
  ),
  prices,
  schedules: z.object({ confirmTill: text, shipTill: text }),
  delivery: z.object({
    serviceName: text,
    serviceType: text,
    trackingNumber: text,
    dispatchNumber: text,
  }),
  availableActions: z
    .array(z.object({ name: z.string(), required: z.boolean() }))
    .nullish(),
});
const pageSchema = z.object({
  orders: z.array(orderSchema).max(20),
  hasMore: z.boolean(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string(),
});
const minor = (value: number | undefined) => {
  if (value === undefined) return null;
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result)) throw new Error('Invalid amount');
  return result;
};
function mapOrder(o: z.infer<typeof orderSchema>): MarketplaceOrder {
  return {
    id: o.id,
    marketplaceId: o.marketplaceId ?? null,
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    items: o.items.map((i) => ({
      avitoId: i.avitoId,
      title: i.title,
      quantity: i.count,
      priceMinor: minor(i.prices.price),
    })),
    priceMinor: minor(o.prices.price),
    schedules: {
      confirmTill: o.schedules.confirmTill ?? null,
      shipTill: o.schedules.shipTill ?? null,
    },
    delivery: {
      serviceName: o.delivery.serviceName ?? null,
      serviceType: o.delivery.serviceType ?? null,
      trackingNumber: o.delivery.trackingNumber ?? null,
      dispatchNumber: o.delivery.dispatchNumber ?? null,
    },
    availableActions: o.availableActions ?? [],
  };
}
class ProviderFailure extends Error {
  constructor(readonly code: OrdersFailure['code']) {
    super(code);
  }
}
export function createAvitoOrderReader(options: {
  clientId: string | undefined;
  clientSecret: string | undefined;
  fetch?: typeof fetch;
  acquireReadSlot?: () => Promise<boolean>;
}): OrderReader {
  const request = options.fetch ?? fetch;
  let token: { value: string; expiresAt: number } | undefined;
  let pendingToken: Promise<string> | undefined;
  let cooldownUntil = 0;
  let nextReadAt = 0;
  function rateLimited(response: Response): never {
    const retry = response.headers.get('retry-after');
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : null;
    const delay =
      seconds !== null
        ? seconds * 1000
        : retry
          ? Date.parse(retry) - Date.now()
          : 60000;
    cooldownUntil =
      Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 60000);
    throw new ProviderFailure('AVITO_RATE_LIMITED');
  }
  async function getToken(): Promise<string> {
    if (token && token.expiresAt > Date.now()) return token.value;
    pendingToken ??= (async () => {
      const response = await request('https://api.avito.ru/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: options.clientId!,
          client_secret: options.clientSecret!,
        }),
      });
      if (response.status === 429) rateLimited(response);
      if (!response.ok)
        throw new ProviderFailure(
          response.status === 429
            ? 'AVITO_RATE_LIMITED'
            : response.status < 500
              ? 'AVITO_ACCESS_DENIED'
              : 'AVITO_UNAVAILABLE',
        );
      const result = tokenSchema.parse(await response.json());
      if (result.token_type.toLowerCase() !== 'bearer')
        throw new ProviderFailure('AVITO_ACCESS_DENIED');
      token = {
        value: result.access_token,
        expiresAt: Date.now() + Math.max(0, result.expires_in - 60) * 1000,
      };
      return token.value;
    })();
    try {
      return await pendingToken;
    } finally {
      pendingToken = undefined;
    }
  }
  async function read(
    path: string,
    params = new URLSearchParams(),
    timeout = 8000,
  ) {
    if (!options.clientId || !options.clientSecret)
      throw new ProviderFailure('AVITO_NOT_CONFIGURED');
    if (cooldownUntil > Date.now())
      throw new ProviderFailure('AVITO_RATE_LIMITED');
    if (options.acquireReadSlot) {
      if (!(await options.acquireReadSlot()))
        throw new ProviderFailure('AVITO_RATE_LIMITED');
    } else {
      if (nextReadAt > Date.now())
        throw new ProviderFailure('AVITO_RATE_LIMITED');
      nextReadAt = Date.now() + 1000;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const value = await getToken();
      const response = await request(
        `https://api.avito.ru${path}?${params.toString()}`,
        {
          method: 'GET',
          redirect: 'error',
          headers: { authorization: `Bearer ${value}` },
          signal: AbortSignal.timeout(timeout),
        },
      );
      if (response.status === 401 && attempt === 0) {
        token = undefined;
        if (options.acquireReadSlot && !(await options.acquireReadSlot()))
          throw new ProviderFailure('AVITO_RATE_LIMITED');
        continue;
      }
      if (response.status === 429) rateLimited(response);
      if (!response.ok)
        throw new ProviderFailure(
          [400, 401, 403].includes(response.status)
            ? 'AVITO_ACCESS_DENIED'
            : 'AVITO_UNAVAILABLE',
        );
      return response.json();
    }
    throw new ProviderFailure('AVITO_ACCESS_DENIED');
  }
  // A photo is optional decoration. Missing Messenger access must never hide orders.
  const photoCache = new Map<
    string,
    { url: string | null; expiresAt: number }
  >();
  const photoPending = new Map<string, Promise<string | null>>();
  let account: Promise<string> | undefined;
  const identifier = z
    .union([
      z.string().regex(/^\d+$/),
      z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ])
    .transform(String);
  const chatPhoto = z.object({
    context: z.object({
      type: z.literal('item'),
      value: z.object({
        id: identifier,
        images: z.object({ main: z.record(z.string(), z.string()) }).nullish(),
      }),
    }),
  });
  async function photo(
    item: z.infer<typeof orderSchema>['items'][number],
  ): Promise<string | null> {
    if (!item.chatId) return null;
    const cached = photoCache.get(item.avitoId);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const pending = photoPending.get(item.avitoId);
    if (pending) return pending;
    const task = (async () => {
      let url: string | null = null;
      try {
        account ??= read('/core/v1/accounts/self', undefined, 4000)
          .then((value) => z.object({ id: identifier }).parse(value).id)
          .catch((error: unknown) => {
            account = undefined;
            throw error;
          });
        const userId = await account;
        const result = chatPhoto.parse(
          await read(
            `/messenger/v2/accounts/${userId}/chats/${encodeURIComponent(item.chatId!)}`,
            undefined,
            4000,
          ),
        );
        if (result.context.value.id === item.avitoId) {
          const main = result.context.value.images?.main ?? {};
          const candidate = main['140x105'] ?? Object.values(main)[0];
          if (candidate) {
            const parsed = new URL(candidate);
            if (
              parsed.protocol === 'https:' &&
              !parsed.username &&
              !parsed.password &&
              /(^|\.)avito\.(st|ru)$/.test(parsed.hostname)
            )
              url = parsed.href;
          }
        }
      } catch {
        /* Optional photo unavailable, including provider rate limiting. */
      }
      if (photoCache.size >= 200)
        photoCache.delete(photoCache.keys().next().value!);
      photoCache.set(item.avitoId, {
        url,
        expiresAt: Date.now() + (url ? 600000 : 60000),
      });
      return url;
    })();
    photoPending.set(item.avitoId, task);
    try {
      return await task;
    } finally {
      photoPending.delete(item.avitoId);
    }
  }
  async function withPhotos(orders: z.infer<typeof orderSchema>[]) {
    // Bound optional requests even if an order has many lines; share account budget.
    const candidates = new Set(
      orders
        .flatMap((order) => order.items)
        .filter((item) => item.chatId)
        .map((item) => item.avitoId)
        .slice(0, 20),
    );
    return Promise.all(
      orders.map(async (order) => {
        const mapped = mapOrder(order);
        mapped.items = await Promise.all(
          mapped.items.map(async (item, index) => ({
            ...item,
            imageUrl: candidates.has(item.avitoId)
              ? await photo(order.items[index]!)
              : null,
          })),
        );
        return mapped;
      }),
    );
  }
  const failure = (error: unknown): OrdersFailure => ({
    ok: false,
    code: error instanceof ProviderFailure ? error.code : 'AVITO_UNAVAILABLE',
  });
  return {
    async list(query: OrderQuery) {
      try {
        const params = new URLSearchParams({
          page: String(query.page),
          limit: String(query.limit),
        });
        if (query.status) params.set('statuses', query.status);
        const result = pageSchema.parse(
          await read('/order-management/1/orders', params),
        );
        return {
          ok: true,
          orders: await withPhotos(result.orders),
          hasMore: result.hasMore,
          fetchedAt: new Date().toISOString(),
          mode: 'read_only',
        };
      } catch (error) {
        return failure(error);
      }
    },
    async get(id: string) {
      try {
        const result = pageSchema.parse(
          await read(
            '/order-management/1/orders',
            new URLSearchParams({ ids: id, page: '1', limit: '20' }),
          ),
        );
        const order = result.orders.find((order) => order.id === id);
        if (!order) return { ok: false, code: 'ORDER_NOT_FOUND' };
        return {
          ok: true,
          order: (await withPhotos([order]))[0]!,
          fetchedAt: new Date().toISOString(),
          mode: 'read_only',
        };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
