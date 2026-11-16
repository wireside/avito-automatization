import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  PipelineError,
  type SessionUser,
  type LabelDownloadLinks,
} from '@avito/domain';
import {
  createMarkingProtector,
  createMarkingUnprotector,
} from './marking-protection.js';

const purpose = 'avito-label-download:v1';
const claimsSchema = z.object({
  userId: z.string(),
  telegramId: z.string(),
  orderId: z.string(),
  operationId: z.uuid(),
  expiresAt: z.number(),
});
export function createLabelDownloadLinks(deps: {
  key: string;
  keyId: string;
  publicUrl: string;
  findActiveUser: (telegramId: string) => Promise<SessionUser | undefined>;
  now?: () => number;
}): LabelDownloadLinks {
  const encrypt = createMarkingProtector(deps.key, deps.keyId);
  const decrypt = createMarkingUnprotector(deps.key, deps.keyId);
  const identityHash = createHash('sha256').update(purpose).digest('hex');
  const now = deps.now ?? Date.now;
  return {
    issue(user: SessionUser, orderId: string, operationId: string) {
      const expiresAt = now() + 10 * 60 * 1000;
      const encrypted = encrypt(
        JSON.stringify({
          userId: user.id,
          telegramId: user.telegramId,
          orderId,
          operationId,
          expiresAt,
        }),
        purpose,
      );
      const ticket = Buffer.from(encrypted.payloadCiphertext).toString(
        'base64url',
      );
      const url = new URL('/avito/label', deps.publicUrl);
      url.hash = ticket;
      return { url: url.href, expiresAt: new Date(expiresAt).toISOString() };
    },
    async resolve(ticket: string) {
      let claims: z.infer<typeof claimsSchema>;
      try {
        claims = claimsSchema.parse(
          JSON.parse(
            decrypt(
              Buffer.from(ticket, 'base64url').toString(),
              deps.keyId,
              identityHash,
            ),
          ),
        );
        if (claims.expiresAt <= now()) throw Error();
      } catch {
        throw new PipelineError('UNAUTHORIZED');
      }
      const user = await deps.findActiveUser(claims.telegramId);
      if (!user || user.id !== claims.userId)
        throw new PipelineError('UNAUTHORIZED');
      return { user, orderId: claims.orderId, operationId: claims.operationId };
    },
  };
}
