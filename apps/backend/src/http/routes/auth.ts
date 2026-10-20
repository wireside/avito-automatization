import {
  telegramAuthRequestSchema,
  telegramAuthResponseSchema,
} from '@avito/contracts';
import type { FastifyInstance } from 'fastify';
import type { SessionResult } from '@avito/domain';
import { sendApiError } from '../errors.js';

export function registerAuthRoutes(
  app: FastifyInstance,
  verifySession: (initData: string) => Promise<SessionResult>,
) {
  app.post(
    '/api/v1/auth/telegram/verify',
    { bodyLimit: 32768 },
    async (request, reply) => {
      const parsed = telegramAuthRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return sendApiError(reply, request, 'INVALID_REQUEST');
      const result = await verifySession(parsed.data.initData);
      if (!result.ok) return sendApiError(reply, request, result.code);
      return telegramAuthResponseSchema.parse({ user: result.user });
    },
  );
}
