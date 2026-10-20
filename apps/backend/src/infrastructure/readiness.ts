import type { DatabaseClient } from '@avito/database';
import type { RedisConnection } from './redis.js';

export function createReadinessCheck(
  database: DatabaseClient,
  redis: RedisConnection,
) {
  return async () => {
    const checks = await Promise.allSettled([
      database.pool.query('select 1'),
      redis.ping(),
    ]);
    return {
      postgres:
        checks[0]?.status === 'fulfilled'
          ? ('ok' as const)
          : ('error' as const),
      redis:
        checks[1]?.status === 'fulfilled'
          ? ('ok' as const)
          : ('error' as const),
    };
  };
}
