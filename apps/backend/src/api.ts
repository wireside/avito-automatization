import { createDatabaseClient } from '@avito/database';
import { createRedisConnection } from '@avito/queue';

import { buildApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const database = createDatabaseClient(config.DATABASE_URL);
const redis = createRedisConnection(config.REDIS_URL);
const app = await buildApp({ config, database, redis });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down API');
  await app.close();
  await Promise.all([database.pool.end(), redis.quit()]);
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
