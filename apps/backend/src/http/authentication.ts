import type { SessionResult } from '@avito/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendApiError } from './errors.js';

export function createHttpAuthentication(
  verifySession: (initData: string) => Promise<SessionResult>,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authorization = request.headers.authorization;
    const matched = authorization && /^tma (.+)$/i.exec(authorization);
    if (!matched || matched[1]!.length > 16384) {
      await sendApiError(reply, request, 'UNAUTHORIZED');
      return;
    }
    const session = await verifySession(matched[1]!);
    if (!session.ok) {
      await sendApiError(reply, request, session.code);
      return;
    }
    return session.user;
  };
}
