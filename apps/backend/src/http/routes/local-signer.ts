import { timingSafeEqual, createHash } from 'node:crypto';
import { signingClaimRequest, signingSubmitRequest } from '@avito/contracts';
import { PipelineError, type LocalSignerService } from '@avito/domain';
import type { FastifyInstance } from 'fastify';
export function registerLocalSignerRoutes(
  app: FastifyInstance,
  service: LocalSignerService | undefined,
  token: string | undefined,
) {
  for (const action of ['claim', 'submit'] as const)
    app.post(
      '/api/v1/local-signer/' + action,
      { bodyLimit: 262144 },
      async (request, reply) => {
        if (!token || !service)
          return reply
            .code(503)
            .send({ ok: false, code: 'LOCAL_SIGNER_NOT_CONFIGURED' });
        const supplied =
          request.headers.authorization?.match(/^Bearer (.{1,512})$/)?.[1] ??
          '';
        const digest = (s: string) => createHash('sha256').update(s).digest();
        if (!timingSafeEqual(digest(supplied), digest(token)))
          return reply.code(401).send({ ok: false, code: 'UNAUTHORIZED' });
        try {
          if (action === 'claim') {
            const parsed = signingClaimRequest.safeParse(request.body);
            if (!parsed.success)
              return reply
                .code(400)
                .send({ ok: false, code: 'INVALID_REQUEST' });
            return { task: await service.claim(parsed.data) };
          }
          const parsed = signingSubmitRequest.safeParse(request.body);
          if (!parsed.success)
            return reply.code(400).send({ ok: false, code: 'INVALID_REQUEST' });
          return await service.submit(parsed.data);
        } catch (error) {
          if (error instanceof PipelineError)
            return reply.code(409).send({ ok: false, code: error.code });
          throw error;
        }
      },
    );
}
