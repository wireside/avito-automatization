import { z } from 'zod';
import {
  ProviderError,
  type LegalProvider,
  type ProviderDocument,
  type CodeObservation,
} from '@avito/domain';
const challenge = z.object({
  uuid: z.string().min(1),
  data: z.string().min(1),
});
const token = z.object({
  uuidToken: z.string().optional(),
  token: z.string().optional(),
  expireDate: z.string().optional(),
});
export interface ChzSessionAccess {
  getToken(): Promise<string | null>;
  invalidate(): Promise<void>;
}
export function createTrueApiClient(options: {
  session: ChzSessionAccess;
  fetch?: typeof fetch;
  submissionsEnabled?: boolean;
}) {
  const fetcher = options.fetch ?? fetch;
  async function request(
    path: string,
    body?: unknown,
    authorized = true,
    mutation = false,
  ): Promise<unknown> {
    if (mutation && !options.submissionsEnabled)
      throw new ProviderError('DOCUMENT_SUBMISSION_DISABLED');
    const auth = authorized ? await options.session.getToken() : null;
    if (authorized && !auth) throw new ProviderError('CHZ_AUTH_REQUIRED', true);
    let response: Response;
    try {
      response = await fetcher('https://markirovka.crpt.ru' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(auth ? { authorization: 'Bearer ' + auth } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ProviderError(
        mutation ? 'SUBMISSION_RESULT_UNKNOWN' : 'CHZ_UNAVAILABLE',
        !mutation,
        mutation,
      );
    }
    if (response.status === 401) {
      if (authorized) await options.session.invalidate();
      throw new ProviderError('CHZ_AUTH_REQUIRED', true);
    }
    if (!response.ok)
      throw new ProviderError(
        response.status === 429
          ? 'CHZ_RATE_LIMITED'
          : 'CHZ_HTTP_' + response.status,
        !mutation && (response.status === 429 || response.status >= 500),
        mutation && response.status >= 500,
      );
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new ProviderError(
        mutation ? 'SUBMISSION_RESULT_UNKNOWN' : 'CHZ_UNAVAILABLE',
        !mutation,
        mutation,
      );
    }
    if (text.length > 8_000_000)
      throw new ProviderError('CHZ_RESPONSE_TOO_LARGE');
    try {
      return JSON.parse(text) as unknown;
    } catch {
      if (mutation && /^[A-Za-z0-9_-]{1,200}$/.test(text)) return text;
      throw new ProviderError(
        mutation ? 'SUBMISSION_RESULT_UNKNOWN' : 'CHZ_INVALID_RESPONSE',
        false,
        mutation,
      );
    }
  }
  const client: LegalProvider = {
    async authorizeSubmission() {
      if (!options.submissionsEnabled)
        throw new ProviderError('DOCUMENT_SUBMISSION_DISABLED');
      if (!(await options.session.getToken()))
        throw new ProviderError('CHZ_AUTH_REQUIRED', true);
    },
    async check(cises) {
      if (
        cises.length < 1 ||
        cises.length > 1000 ||
        new Set(cises).size !== cises.length
      )
        throw new ProviderError('INVALID_CODE_BATCH');
      const result = await request('/api/v3/true-api/cises/info', cises);
      const parsed = z
        .array(
          z.object({
            cisInfo: z
              .object({
                cis: z.string(),
                requestedCis: z.string().optional(),
                status: z.string(),
                statusEx: z.string().nullish(),
                ownerInn: z.string().nullish(),
              })
              .optional(),
            errorCode: z.union([z.string(), z.number()]).optional(),
          }),
        )
        .safeParse(result);
      if (!parsed.success) throw new ProviderError('CHZ_INVALID_RESPONSE');
      return parsed.data.flatMap((r) =>
        r.cisInfo
          ? [
              {
                cis: r.cisInfo.requestedCis ?? r.cisInfo.cis,
                status: r.cisInfo.status,
                statusEx: r.cisInfo.statusEx ?? '',
                ownerInn: r.cisInfo.ownerInn ?? '',
                observedAt: new Date().toISOString(),
              } satisfies CodeObservation,
            ]
          : [],
      );
    },
    async document(id) {
      const schema = z.object({
        number: z.string(),
        status: z.string(),
        senderInn: z.string().nullish(),
        receiverInn: z.string().nullish(),
        type: z.string(),
        body: z.unknown(),
      });
      const page = async (n: number) => {
        const result = await request(
          '/api/v4/true-api/doc/' +
            encodeURIComponent(id) +
            '/info?pg=lp&body=true&limit=1000&pageNumber=' +
            n,
        );
        const records = z.array(schema).safeParse(result);
        if (
          !records.success ||
          records.data.length !== 1 ||
          records.data[0]!.number !== id
        )
          throw new ProviderError('CHZ_DOCUMENT_RESPONSE_MISMATCH');
        return records.data[0]!;
      };
      const r = await page(1);
      let body = r.body;
      if (
        [
          'UNIVERSAL_TRANSFER_DOCUMENT',
          'UNIVERSAL_TRANSFER_DOCUMENT_FIX',
        ].includes(r.type) &&
        r.status === 'CHECKED_OK'
      ) {
        const transfer = z
          .object({
            products: z.array(
              z
                .object({ code: z.string(), codeType: z.string() })
                .passthrough(),
            ),
            productsTotal: z.number().int().nonnegative().max(100000),
          })
          .passthrough();
        const first = transfer.safeParse(body);
        if (!first.success)
          throw new ProviderError('CHZ_DOCUMENT_BODY_INCOMPLETE');
        const products = [...first.data.products],
          total = first.data.productsTotal;
        for (let n = 2; products.length < total; n++) {
          if (n > 100 || products.length !== (n - 1) * 1000)
            throw new ProviderError('CHZ_DOCUMENT_PAGINATION_INVALID');
          const next = await page(n),
            p = transfer.safeParse(next.body);
          if (
            next.status !== r.status ||
            next.senderInn !== r.senderInn ||
            next.receiverInn !== r.receiverInn ||
            next.type !== r.type ||
            !p.success ||
            p.data.productsTotal !== total ||
            p.data.products.length === 0
          )
            throw new ProviderError('CHZ_DOCUMENT_CHANGED', true);
          products.push(...p.data.products);
        }
        if (products.length !== total)
          throw new ProviderError('CHZ_DOCUMENT_PAGINATION_INVALID');
        body = { ...first.data, products };
      }
      return {
        id: r.number,
        status: r.status,
        senderInn: r.senderInn ?? '',
        receiverInn: r.receiverInn ?? '',
        type: r.type,
        body,
      } satisfies ProviderDocument;
    },
    async submit(input) {
      const result = await request(
        '/api/v3/true-api/lk/documents/create?pg=lp',
        {
          document_format: 'MANUAL',
          product_document: input.payloadBase64,
          type: input.type,
          signature: input.signatureBase64,
        },
        true,
        true,
      );
      if (typeof result !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(result))
        throw new ProviderError('SUBMISSION_RESULT_UNKNOWN', false, true);
      return result;
    },
  };
  return {
    ...client,
    async places(inn: string) {
      const entry = z.object({
        inn: z.string(),
        productGroups: z.array(z.string()),
        fiasId: z.uuid().nullish(),
        address: z.string().nullish(),
      });
      const schema = z.object({
        result: z.array(entry).max(1000),
        total: z.number().int().nonnegative().max(100000),
        nextPage: z.boolean(),
      });
      const items = new Map<string, { fiasId: string; address: string }>();
      let incompleteCount = 0,
        count = 0,
        total: number | undefined;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({
          inns: inn,
          productGroups: 'lp',
          limit: '1000',
          page: String(page),
        });
        const response = schema.safeParse(
          await request('/api/v3/true-api/mods/list?' + query.toString()),
        );
        if (!response.success) throw new ProviderError('CHZ_INVALID_RESPONSE');
        const data = response.data;
        total ??= data.total;
        if (data.total !== total || (data.nextPage && data.result.length === 0))
          throw new ProviderError('CHZ_PLACES_CHANGED', true);
        count += data.result.length;
        for (const row of data.result) {
          if (row.inn !== inn || !row.productGroups.includes('lp'))
            throw new ProviderError('CHZ_PLACES_RESPONSE_MISMATCH');
          if (!row.fiasId || !row.address?.trim()) {
            incompleteCount++;
            continue;
          }
          const previous = items.get(row.fiasId);
          if (previous && previous.address !== row.address)
            throw new ProviderError('CHZ_PLACES_CHANGED', true);
          items.set(row.fiasId, { fiasId: row.fiasId, address: row.address });
        }
        if (count > total) throw new ProviderError('CHZ_INVALID_RESPONSE');
        if (!data.nextPage) {
          if (count !== total)
            throw new ProviderError('CHZ_PLACES_CHANGED', true);
          return { items: [...items.values()], incompleteCount };
        }
      }
      throw new ProviderError('CHZ_RESPONSE_TOO_LARGE');
    },
    async challenge() {
      const parsed = challenge.safeParse(
        await request('/api/v3/true-api/auth/key', undefined, false),
      );
      if (!parsed.success) throw new ProviderError('CHZ_INVALID_RESPONSE');
      return parsed.data;
    },
    async authenticate(uuid: string, signedData: string, inn: string) {
      const parsed = token.safeParse(
        await request(
          '/api/v3/true-api/auth/simpleSignIn',
          { uuid, data: signedData, inn, unitedToken: true },
          false,
        ),
      );
      if (!parsed.success || !(parsed.data.uuidToken ?? parsed.data.token))
        throw new ProviderError('CHZ_AUTH_REJECTED');
      return {
        token: (parsed.data.uuidToken ?? parsed.data.token)!,
        expiresAt: parsed.data.expireDate
          ? new Date(parsed.data.expireDate).toISOString()
          : new Date(Date.now() + 9 * 3600_000).toISOString(),
      };
    },
  };
}
