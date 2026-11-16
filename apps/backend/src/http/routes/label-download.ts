import { z } from 'zod';
import { orderParamsSchema } from '@avito/contracts';
import { PipelineError, ProviderError } from '@avito/domain';
import type { FastifyInstance } from 'fastify';
import type { HttpServices } from '../app.js';
import { createHttpAuthentication } from '../authentication.js';
import { labelDownloadPage } from '../label-download-page.js';
import { sendApiError } from '../errors.js';

export function registerLabelDownloadRoutes(
  app: FastifyInstance,
  services: HttpServices,
) {
  const authenticate = createHttpAuthentication(services.verifyTelegramSession);
  app.get('/avito/label', async (_request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('content-security-policy', labelDownloadPage.csp)
      .header('x-content-type-options', 'nosniff')
      .type('text/html; charset=utf-8')
      .send(labelDownloadPage.html),
  );
  const handleError = (
    error: unknown,
    request: Parameters<typeof sendApiError>[1],
    reply: Parameters<typeof sendApiError>[0],
  ) => {
    if (
      (error instanceof PipelineError || error instanceof ProviderError) &&
      [
        'UNAUTHORIZED',
        'FORBIDDEN',
        'AVITO_LABEL_PENDING',
        'ORDER_ACTION_UNAVAILABLE',
        'AVITO_NOT_CONFIGURED',
        'AVITO_ACCESS_DENIED',
        'AVITO_UNAVAILABLE',
        'AVITO_RATE_LIMITED',
      ].includes(error.code)
    )
      return sendApiError(
        reply,
        request,
        error.code as Parameters<typeof sendApiError>[2],
      );
    throw error;
  };
  app.post(
    '/api/v1/orders/:id/actions/:operationId/label-link',
    async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const params = orderParamsSchema
        .extend({ operationId: z.uuid() })
        .safeParse(request.params);
      if (!params.success)
        return sendApiError(reply, request, 'INVALID_REQUEST');
      if (!services.avitoOrderActions)
        return sendApiError(reply, request, 'ORDER_ACTIONS_DISABLED');
      if (!services.labelDownloadLinks)
        return sendApiError(reply, request, 'MARKING_STORAGE_NOT_CONFIGURED');
      try {
        const { id, operationId } = params.data;
        const list = await services.avitoOrderActions.list(user, id);
        if (
          !list.operations.some((op) => op.id === operationId && op.labelReady)
        )
          throw new PipelineError('AVITO_LABEL_PENDING');
        return services.labelDownloadLinks.issue(user, id, operationId);
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );
  app.post(
    '/api/v1/avito-label/download',
    { bodyLimit: 8192 },
    async (request, reply) => {
      const body = z
        .object({
          ticket: z
            .string()
            .min(1)
            .max(4096)
            .regex(/^[A-Za-z0-9_-]+$/),
        })
        .strict()
        .safeParse(request.body);
      if (!body.success) return sendApiError(reply, request, 'INVALID_REQUEST');
      if (!services.avitoOrderActions || !services.labelDownloadLinks)
        return sendApiError(reply, request, 'ORDER_ACTIONS_DISABLED');
      try {
        const { user, orderId, operationId } =
          await services.labelDownloadLinks.resolve(body.data.ticket);
        const pdf = await services.avitoOrderActions.download(
          user,
          orderId,
          operationId,
        );
        return reply
          .type('application/pdf')
          .header(
            'content-disposition',
            'attachment; filename="avito-label.pdf"',
          )
          .header('x-content-type-options', 'nosniff')
          .send(Buffer.from(pdf));
      } catch (error) {
        return handleError(error, request, reply);
      }
    },
  );
}
