import type { FastifyInstance } from 'fastify';
import { signerInstallRequest, signerRegisterRequest } from '@avito/contracts';
import {
  PipelineError,
  type SignerEnrollment,
  type SessionResult,
} from '@avito/domain';
import { createHttpAuthentication } from '../authentication.js';
import { signerInstallPage } from '../signer-install-page.js';
export function registerSignerEnrollmentRoutes(
  app: FastifyInstance,
  deps: {
    verifyTelegramSession: (data: string) => Promise<SessionResult>;
    signerEnrollment?: SignerEnrollment;
    signerInstaller?: (connection: {
      backendUrl: string;
      ticket: string;
    }) => Promise<Uint8Array>;
  },
) {
  const authenticate = createHttpAuthentication(deps.verifyTelegramSession);
  app.get('/signer/install', async (_req, reply) =>
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('content-security-policy', signerInstallPage.csp)
      .header('x-content-type-options', 'nosniff')
      .type('text/html; charset=utf-8')
      .send(signerInstallPage.html),
  );
  for (const action of [
    'install-link',
    'install',
    'register',
    'status',
  ] as const)
    app.post(
      '/api/v1/local-signer/' + action,
      { bodyLimit: 65536 },
      async (req, reply) => {
        try {
          if (action === 'install-link') {
            const user = await authenticate(req, reply);
            if (!user) return;
            if (!deps.signerEnrollment)
              return reply
                .code(503)
                .send({ ok: false, code: 'INSTALL_NOT_CONFIGURED' });
            return await deps.signerEnrollment.issue(user);
          }
          if (!deps.signerEnrollment)
            return reply
              .code(503)
              .send({ ok: false, code: 'INSTALL_NOT_CONFIGURED' });
          if (action === 'status') {
            const token =
              req.headers.authorization?.match(/^Bearer (.{1,512})$/)?.[1];
            if (!token)
              return reply.code(401).send({ ok: false, code: 'UNAUTHORIZED' });
            return await deps.signerEnrollment.status(token);
          }
          const parsed = (
            action === 'install' ? signerInstallRequest : signerRegisterRequest
          ).safeParse(req.body);
          if (!parsed.success)
            return reply.code(400).send({ ok: false, code: 'INVALID_REQUEST' });
          if (action === 'install') {
            if (!deps.signerInstaller)
              return reply
                .code(503)
                .send({ ok: false, code: 'INSTALL_NOT_CONFIGURED' });
            const c = await deps.signerEnrollment.download(parsed.data.ticket);
            return reply
              .header('cache-control', 'no-store')
              .header(
                'content-disposition',
                'attachment; filename="AvitoSigner-Windows.zip"',
              )
              .header('x-content-type-options', 'nosniff')
              .type('application/zip')
              .send(Buffer.from(await deps.signerInstaller(c)));
          }
          const input = signerRegisterRequest.parse(req.body);
          return await deps.signerEnrollment.register(input);
        } catch (e) {
          if (e instanceof PipelineError)
            return reply
              .code(
                e.code === 'FORBIDDEN'
                  ? 403
                  : e.code === 'UNAUTHORIZED'
                    ? 401
                    : e.code === 'INSTALL_LINK_RATE_LIMITED'
                      ? 429
                      : 409,
              )
              .send({ ok: false, code: e.code });
          throw e;
        }
      },
    );
}
