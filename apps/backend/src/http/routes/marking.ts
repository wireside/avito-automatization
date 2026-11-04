import { markingRequests, markingQuery, markingParams } from '@avito/contracts';
import {
  PipelineError,
  type MarkingPipeline,
  type PipelineAction,
  type SessionResult,
} from '@avito/domain';
import type { FastifyInstance } from 'fastify';
import { createHttpAuthentication } from '../authentication.js';
export function registerMarkingRoutes(
  app: FastifyInstance,
  services: {
    verifyTelegramSession: (data: string) => Promise<SessionResult>;
    markingPipeline?: MarkingPipeline;
  },
) {
  const authenticate = createHttpAuthentication(services.verifyTelegramSession);
  const failure = (error: unknown, requestId: string) => {
    if (!(error instanceof PipelineError)) throw error;
    return {
      code:
        error.code === 'FORBIDDEN'
          ? 403
          : error.code === 'LEGAL_PROVIDER_DISABLED'
            ? 503
            : error.code === 'ENTITY_NOT_FOUND'
              ? 404
              : 409,
      body: {
        ok: false,
        code: error.code,
        blockers: error.blockers,
        requestId,
      },
    };
  };
  for (const action of Object.keys(markingRequests) as PipelineAction[])
    app.post(
      '/api/v1/marking/commands/' + action,
      { bodyLimit: 262144 },
      async (request, reply) => {
        const user = await authenticate(request, reply);
        if (!user) return;
        const parsed = markingRequests[action].safeParse(request.body);
        if (!parsed.success)
          return reply.code(400).send({
            ok: false,
            code: 'INVALID_REQUEST',
            blockers: [],
            requestId: request.id,
          });
        if (!services.markingPipeline)
          return reply.code(503).send({
            ok: false,
            code: 'LEGAL_PROVIDER_DISABLED',
            blockers: [],
            requestId: request.id,
          });
        try {
          return await services.markingPipeline.command(
            user,
            action,
            parsed.data,
          );
        } catch (error) {
          const f = failure(error, request.id);
          return reply.code(f.code).send(f.body);
        }
      },
    );
  const routes = [
    ['overview', 'overview'],
    ['shipments', 'shipments'],
    ['shipments/:id', 'shipment'],
    ['units/:id', 'unit'],
    ['documents', 'documents'],
    ['documents/:id', 'document'],
    ['documents/:id/export', 'export'],
    ['issues', 'issues'],
    ['settings', 'settings'],
  ] as const;
  for (const [path, kind] of routes)
    app.get('/api/v1/marking/' + path, async (request, reply) => {
      const user = await authenticate(request, reply);
      if (!user) return;
      const query = markingQuery.safeParse(request.query),
        params = path.includes(':id')
          ? markingParams.safeParse(request.params)
          : null;
      if (!query.success || (params && !params.success))
        return reply.code(400).send({
          ok: false,
          code: 'INVALID_REQUEST',
          blockers: [],
          requestId: request.id,
        });
      if (!services.markingPipeline)
        return reply.code(503).send({
          ok: false,
          code: 'LEGAL_PROVIDER_DISABLED',
          blockers: [],
          requestId: request.id,
        });
      if (kind === 'export')
        reply.header(
          'content-disposition',
          `attachment; filename=chz-document-${params?.success ? params.data.id : 'export'}.json`,
        );
      try {
        return await services.markingPipeline.read(
          user,
          kind,
          params?.success ? params.data.id : undefined,
          query.data.offset,
        );
      } catch (error) {
        const f = failure(error, request.id);
        return reply.code(f.code).send(f.body);
      }
    });
}
