import { timingSafeEqual, createHash } from 'node:crypto';
import {
  signingClaimRequest,
  signingSubmitRequest,
  signerHeartbeatRequest,
} from '@avito/contracts';
import {
  PipelineError,
  type SignerBinding,
  type LocalSignerService,
} from '@avito/domain';
import type { FastifyInstance } from 'fastify';
export function registerLocalSignerRoutes(
  app: FastifyInstance,
  service: LocalSignerService | undefined,
  token: string | undefined,
  resolve?: (
    token: string,
  ) => Promise<{ binding: SignerBinding; service: LocalSignerService } | null>,
) {
  for (const action of ['claim', 'submit', 'heartbeat'] as const)
    app.post(
      '/api/v1/local-signer/' + action,
      { bodyLimit: 262144 },
      async (request, reply) => {
        if ((!token || !service) && !resolve)
          return reply
            .code(503)
            .send({ ok: false, code: 'LOCAL_SIGNER_NOT_CONFIGURED' });
        const supplied =
          request.headers.authorization?.match(/^Bearer (.{1,512})$/)?.[1] ??
          '';
        const digest = (s: string) => createHash('sha256').update(s).digest();
        const device = supplied && resolve ? await resolve(supplied) : null;
        const legacy = !!(
          token &&
          service &&
          timingSafeEqual(digest(supplied), digest(token))
        );
        if (!device && !legacy)
          return reply.code(401).send({ ok: false, code: 'UNAUTHORIZED' });
        const selected = device?.service ?? service!;
        const body = request.body as { signerId?: unknown } | null;
        if (device && body?.signerId !== device.binding.signerId)
          return reply
            .code(403)
            .send({ ok: false, code: 'SIGNER_DEVICE_MISMATCH' });
        try {
          if (action === 'claim') {
            const parsed = signingClaimRequest.safeParse(request.body);
            if (!parsed.success)
              return reply
                .code(400)
                .send({ ok: false, code: 'INVALID_REQUEST' });
            return { task: await selected.claim(parsed.data) };
          }
          if (action === 'heartbeat') {
            const parsed = signerHeartbeatRequest.safeParse(request.body);
            if (!parsed.success)
              return reply
                .code(400)
                .send({ ok: false, code: 'INVALID_REQUEST' });
            await selected.heartbeat(parsed.data);
            return { ok: true };
          }
          const parsed = signingSubmitRequest.safeParse(request.body);
          if (!parsed.success)
            return reply.code(400).send({ ok: false, code: 'INVALID_REQUEST' });
          return await selected.submit(parsed.data);
        } catch (error) {
          if (error instanceof PipelineError)
            return reply.code(409).send({ ok: false, code: error.code });
          throw error;
        }
      },
    );
}
