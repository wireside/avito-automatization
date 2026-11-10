import { z } from 'zod';
import { courierOptionsSchema } from '@avito/contracts';
import {
  ProviderError,
  type AvitoActionProvider,
  type AvitoActionCommand,
  type MarketplaceOrder,
} from '@avito/domain';
export function createAvitoActionProvider(options: {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  writesEnabled: boolean;
  fetch?: typeof fetch;
  acquireSlot?: () => Promise<boolean>;
}): AvitoActionProvider {
  const fetcher = options.fetch ?? fetch;
  let token: { value: string; until: number } | undefined;
  let pendingToken: Promise<string> | undefined;
  let cooldown = 0;
  async function credentials() {
    if (!options.clientId || !options.clientSecret)
      throw new ProviderError('AVITO_NOT_CONFIGURED');
    if (token && token.until > Date.now()) return token.value;
    pendingToken ??= (async () => {
      let r: Response;
      try {
        r = await fetcher('https://api.avito.ru/token', {
          method: 'POST',
          redirect: 'error',
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
          r.status === 429
            ? 'AVITO_RATE_LIMITED'
            : r.status >= 500
              ? 'AVITO_UNAVAILABLE'
              : 'AVITO_ACCESS_DENIED',
          r.status === 429 || r.status >= 500,
        );
      const result = z
        .object({
          access_token: z.string().min(1),
          expires_in: z.number().positive(),
          token_type: z.string().optional(),
        })
        .safeParse(await r.json().catch(() => null));
      if (
        !result.success ||
        (result.data.token_type &&
          result.data.token_type.toLowerCase() !== 'bearer')
      )
        throw new ProviderError('AVITO_ACCESS_DENIED');
      token = {
        value: result.data.access_token,
        until: Date.now() + Math.max(0, result.data.expires_in - 60) * 1000,
      };
      return token.value;
    })();
    try {
      return await pendingToken;
    } finally {
      pendingToken = undefined;
    }
  }
  async function request(
    path: string,
    body?: unknown,
    beforeSend?: () => Promise<void>,
  ) {
    if (body !== undefined && !options.writesEnabled)
      throw new ProviderError('ORDER_ACTIONS_DISABLED');
    if (
      cooldown > Date.now() ||
      (options.acquireSlot && !(await options.acquireSlot()))
    )
      throw new ProviderError('AVITO_RATE_LIMITED', true);
    for (let attempt = 0; attempt < 2; attempt++) {
      const access = await credentials();
      if (attempt === 0) await beforeSend?.();
      let r: Response;
      try {
        r = await fetcher('https://api.avito.ru' + path, {
          method: body === undefined ? 'GET' : 'POST',
          redirect: 'error',
          headers: {
            authorization: 'Bearer ' + access,
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new ProviderError(
          body === undefined
            ? 'AVITO_UNAVAILABLE'
            : 'AVITO_ACTION_RESULT_UNKNOWN',
          body === undefined,
          body !== undefined,
        );
      }
      if (r.status === 401 && attempt === 0) {
        token = undefined;
        if (options.acquireSlot && !(await options.acquireSlot()))
          throw new ProviderError('AVITO_RATE_LIMITED', true);
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
          cooldown =
            Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 60000);
        }
        throw new ProviderError(
          r.status === 429
            ? 'AVITO_RATE_LIMITED'
            : [401, 403].includes(r.status)
              ? 'AVITO_ACCESS_DENIED'
              : r.status === 404 && body === undefined
                ? 'AVITO_LABEL_PENDING'
                : body !== undefined && r.status >= 500
                  ? 'AVITO_ACTION_RESULT_UNKNOWN'
                  : r.status >= 500
                    ? 'AVITO_UNAVAILABLE'
                    : 'AVITO_ACTION_REJECTED',
          body === undefined
            ? r.status >= 500 || r.status === 429
            : r.status === 429,
          body !== undefined && r.status >= 500,
        );
      }
      return r;
    }
    throw new ProviderError('AVITO_ACCESS_DENIED');
  }
  async function json(r: Response, mutation: boolean) {
    try {
      return await r.json();
    } catch {
      throw new ProviderError(
        mutation ? 'AVITO_ACTION_RESULT_UNKNOWN' : 'AVITO_UNAVAILABLE',
        !mutation,
        mutation,
      );
    }
  }
  function commandRequest(
    order: MarketplaceOrder,
    command: AvitoActionCommand,
  ) {
    const d = command.data,
      orderId = order.id;
    switch (command.action) {
      case 'confirm':
      case 'reject':
      case 'perform':
      case 'receive':
        return {
          path: '/order-management/1/order/applyTransition',
          body: {
            orderId,
            transition: command.action,
            ...(command.action === 'receive' && d.confirmCode
              ? {
                  params: {
                    cnc: {
                      confirmCode: d.confirmCode,
                      marketplaceId: order.marketplaceId,
                    },
                  },
                }
              : {}),
          },
        };
      case 'setTrackNumber':
      case 'fixTrackNumber':
        return {
          path: '/order-management/1/order/setTrackingNumber',
          body: { orderId, trackingNumber: d.trackingNumber },
        };
      case 'acceptReturnOrder':
        return {
          path: '/order-management/1/order/acceptReturnOrder',
          body: {
            orderId,
            terminalNumber: d.terminalNumber,
            recipient: { name: d.name, phone: d.phone },
          },
        };
      case 'setCNCDetails':
        return {
          path: '/order-management/1/order/cncSetDetails',
          body: { id: orderId, marketplaceId: order.marketplaceId, ...d },
        };
      case 'setCourierDeliveryRange':
        return {
          path: '/order-management/1/order/setCourierDeliveryRange',
          body: { orderId, ...d },
        };
      case 'label':
        return {
          path: '/order-management/1/orders/labels',
          body: { orderIDs: [order.marketplaceId] },
        };
    }
  }
  return {
    async execute(order, command, beforeSend) {
      const req = commandRequest(order, command);
      const result = await json(
        await request(req.path, req.body, beforeSend),
        true,
      );
      if (command.action === 'label') {
        const parsed = z
          .object({ taskID: z.string().min(1).max(200) })
          .safeParse(result);
        if (!parsed.success)
          throw new ProviderError('AVITO_ACTION_RESULT_UNKNOWN', false, true);
        return { labelTaskId: parsed.data.taskID };
      }
      const schema =
        command.action === 'setCNCDetails'
          ? z
              .object({ result: z.object({ success: z.boolean() }) })
              .transform((r) => r.result)
          : z.object({ success: z.boolean() });
      const parsed = schema.safeParse(result);
      if (!parsed.success)
        throw new ProviderError('AVITO_ACTION_RESULT_UNKNOWN', false, true);
      if (!parsed.data.success)
        throw new ProviderError('AVITO_ACTION_REJECTED');
      return {};
    },
    async courier(orderId, address) {
      const q = new URLSearchParams({ orderId });
      if (address) q.set('address', address);
      const parsed = z
        .object({ status: z.string(), result: courierOptionsSchema })
        .safeParse(
          await json(
            await request(
              '/order-management/1/order/getCourierDeliveryRange?' +
                q.toString(),
            ),
            false,
          ),
        );
      if (!parsed.success) throw new ProviderError('AVITO_UNAVAILABLE', true);
      return parsed.data.result;
    },
    async download(taskId) {
      const r = await request(
        '/order-management/1/orders/labels/' +
          encodeURIComponent(taskId) +
          '/download',
      );
      if (
        !r.headers
          .get('content-type')
          ?.toLowerCase()
          .includes('application/pdf')
      )
        throw new ProviderError('AVITO_LABEL_PENDING');
      const max = 10 * 1024 * 1024,
        reader = r.body?.getReader() as
          ReadableStreamDefaultReader<Uint8Array> | undefined;
      if (!reader) throw new ProviderError('AVITO_UNAVAILABLE');
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > max) throw new ProviderError('AVITO_RESPONSE_TOO_LARGE');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
        throw new ProviderError('AVITO_UNAVAILABLE');
      return bytes;
    },
  };
}
