import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  db: Database;
  pool: Pool;
}

export function createDatabaseClient(
  connectionString: string,
  overrides: PoolConfig = {},
): DatabaseClient {
  const pool = new Pool({
    connectionString,
    max: 10,
    ...overrides,
  });

  return { db: drizzle(pool, { schema }), pool };
}
