import { createHash, randomUUID } from 'node:crypto';
import type { createRedisConnection } from '@avito/queue';
// A rolling 60-request/minute account budget shared across API processes.
const script = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1] - 60000)
if redis.call('ZCARD', KEYS[1]) >= 60 then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1], 60000)
return 1
`;
export function createAvitoReadLimiter(
  redis: Pick<ReturnType<typeof createRedisConnection>, 'eval'>,
  clientId: string,
) {
  const key = `avito:orders:read-budget:${createHash('sha256').update(clientId).digest('hex').slice(0, 20)}`;
  return async () =>
    (await redis.eval(script, 1, key, Date.now(), randomUUID())) === 1;
}
