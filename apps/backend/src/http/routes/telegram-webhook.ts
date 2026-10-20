import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export type DeliverTelegramUpdate = (
  update: { update_id: number } & Record<string, unknown>,
) => Promise<'delivered' | 'duplicate' | 'processing' | 'failed'>;
function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function registerTelegramWebhook(
  app: FastifyInstance,
  dependencies: {
    secret: string | undefined;
    deliverUpdate: DeliverTelegramUpdate | undefined;
  },
) {
  app.post('/webhooks/telegram', async (request, reply) => {
    if (!dependencies.deliverUpdate)
      return reply.code(503).send({ code: 'TELEGRAM_NOT_CONFIGURED' });
    const received = request.headers['x-telegram-bot-api-secret-token'];
    if (
      !dependencies.secret ||
      typeof received !== 'string' ||
      !secureEqual(received, dependencies.secret)
    ) {
      return reply.code(401).send({ code: 'INVALID_WEBHOOK_SECRET' });
    }
    const parsed = z
      .object({ update_id: z.number().int().nonnegative() })
      .passthrough()
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ code: 'INVALID_UPDATE' });
    const result = await dependencies.deliverUpdate(parsed.data);
    if (result === 'processing')
      return reply.code(503).send({ code: 'UPDATE_PROCESSING' });
    if (result === 'failed') {
      request.log.error('Telegram update failed');
      return reply.code(502).send({ code: 'TELEGRAM_UPDATE_FAILED' });
    }
    return reply.code(204).send();
  });
}
