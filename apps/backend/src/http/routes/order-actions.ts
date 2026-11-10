import { z } from 'zod';
import { avitoActionCommandSchema, orderParamsSchema } from '@avito/contracts';
import {
  PipelineError,
  ProviderError,
  type AvitoOrderActions,
  type SessionResult,
} from '@avito/domain';
import type { FastifyInstance } from 'fastify';
import { createHttpAuthentication } from '../authentication.js';
import { sendApiError } from '../errors.js';
export function registerAvitoActionRoutes(
  app: FastifyInstance,
  services: {
    verifyTelegramSession: (initData: string) => Promise<SessionResult>;
    avitoOrderActions?: AvitoOrderActions;
  },
) {
  const authenticate = createHttpAuthentication(services.verifyTelegramSession);
  const route = (
    method: 'GET' | 'POST',
    suffix: string,
    handle: (
      service: AvitoOrderActions,
      user: Extract<SessionResult, { ok: true }>['user'],
      id: string,
      body: unknown,
      query: unknown,
      params: unknown,
    ) => Promise<unknown>,
    pdf = false,
  ) => {
    app.route({
      method,
      url: '/api/v1/orders/:id/' + suffix,
      bodyLimit: 8192,
      handler: async (request, reply) => {
        const user = await authenticate(request, reply);
        if (!user) return;
        const params = orderParamsSchema.safeParse(request.params);
        if (!params.success)
          return sendApiError(reply, request, 'INVALID_REQUEST');
        if (!services.avitoOrderActions)
          return sendApiError(reply, request, 'ORDER_ACTIONS_DISABLED');
        try {
          const result = await handle(
            services.avitoOrderActions,
            user,
            params.data.id,
            request.body,
            request.query,
            request.params,
          );
          reply.header('cache-control', 'no-store');
          if (pdf) {
            reply
              .type('application/pdf')
              .header(
                'content-disposition',
                'attachment; filename="avito-label.pdf"',
              );
            return reply.send(Buffer.from(result as Uint8Array));
          }
          return result;
        } catch (error) {
          if (
            error instanceof PipelineError ||
            error instanceof ProviderError
          ) {
            const code = error.code;
            if (
              [
                'FORBIDDEN',
                'INVALID_REQUEST',
                'ORDER_NOT_FOUND',
                'ORDER_ACTIONS_DISABLED',
                'ORDER_ACTION_UNAVAILABLE',
                'ORDER_ACTION_PENDING',
                'IDEMPOTENCY_CONFLICT',
                'MARKING_STORAGE_NOT_CONFIGURED',
                'AVITO_NOT_CONFIGURED',
                'AVITO_ACCESS_DENIED',
                'AVITO_RATE_LIMITED',
                'AVITO_UNAVAILABLE',
                'AVITO_LABEL_PENDING',
              ].includes(code)
            )
              return sendApiError(
                reply,
                request,
                code as Parameters<typeof sendApiError>[2],
              );
          }
          throw error;
        }
      },
    });
  };
  route('GET', 'actions', (s, u, id) => s.list(u, id));
  route('POST', 'actions', (s, u, id, body) => {
    const parsed = avitoActionCommandSchema.safeParse(body);
    if (!parsed.success) throw new PipelineError('INVALID_REQUEST');
    return s.enqueue(u, id, parsed.data);
  });
  route('POST', 'courier-options', (s, u, id, query) => {
    const parsed = z
      .object({ address: z.string().min(1).max(500).optional() })
      .strict()
      .safeParse(query);
    if (!parsed.success) throw new PipelineError('INVALID_REQUEST');
    return s.courier(u, id, parsed.data.address);
  });
  route(
    'GET',
    'actions/:operationId/label',
    (s, u, id, _b, _q, params) => {
      const parsed = z.object({ operationId: z.uuid() }).safeParse(params);
      if (!parsed.success) throw new PipelineError('INVALID_REQUEST');
      return s.download(u, id, parsed.data.operationId);
    },
    true,
  );
  route(
    'POST',
    'actions/:operationId/reconcile',
    (s, u, id, _b, _q, params) => {
      const parsed = z.object({ operationId: z.uuid() }).safeParse(params);
      if (!parsed.success) throw new PipelineError('INVALID_REQUEST');
      return s.reconcile(u, id, parsed.data.operationId);
    },
  );
}
