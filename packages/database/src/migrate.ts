import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabaseClient } from './client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const { db, pool } = createDatabaseClient(databaseUrl, { max: 1 });

try {
  await migrate(db, {
    migrationsFolder: new URL('../migrations', import.meta.url).pathname,
  });
  console.log('Database migrations applied');
} finally {
  await pool.end();
}
