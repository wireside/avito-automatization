import type { createChzSessionStore } from '@avito/database';
import type { createTrueApiClient } from './true-api.js';
export function createChzAuthorization(
  store: ReturnType<typeof createChzSessionStore>,
  client: ReturnType<typeof createTrueApiClient>,
  configured: boolean | (() => Promise<boolean>),
) {
  let running: Promise<void> | undefined;
  async function ensure() {
    if (
      !(typeof configured === 'boolean' ? configured : await configured()) ||
      (await store.getToken())
    )
      return;
    const inn = await store.sellerInn();
    if (!inn) return;
    const job = await store.pending();
    if (job) {
      if (job.status === 'VERIFIED') {
        const signature = store.signature(job);
        const session = await client.authenticate(
          job.auth_uuid,
          signature.signatureBase64,
          inn,
        );
        await store.save(job.id, inn, session.token, session.expiresAt);
      }
      return;
    }
    const challenge = await client.challenge();
    await store.challenge(inn, challenge.uuid, challenge.data);
  }
  return () => {
    running ??= ensure().finally(() => {
      running = undefined;
    });
    return running;
  };
}
