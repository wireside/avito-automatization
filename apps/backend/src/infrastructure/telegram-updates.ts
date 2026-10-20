import type { RedisConnection } from './redis.js';

export function createTelegramUpdateDelivery(dependencies: {
  redis: RedisConnection;
  botId: string;
  handleUpdate: (
    update: { update_id: number } & Record<string, unknown>,
  ) => Promise<void>;
}) {
  return async (update: { update_id: number } & Record<string, unknown>) => {
    // Transport replies only. Business idempotency belongs in PostgreSQL.
    const key = `telegram:${dependencies.botId}:update:${update.update_id}`;
    const acquired = await dependencies.redis.set(
      key,
      'processing',
      'EX',
      60,
      'NX',
    );
    if (!acquired)
      return (await dependencies.redis.get(key)) === 'done'
        ? ('duplicate' as const)
        : ('processing' as const);
    try {
      await dependencies.handleUpdate(update);
      await dependencies.redis.set(key, 'done', 'EX', 86_400);
      return 'delivered' as const;
    } catch {
      await dependencies.redis.del(key);
      return 'failed' as const;
    }
  };
}
