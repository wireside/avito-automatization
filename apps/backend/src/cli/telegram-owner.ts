import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '@avito/database';
import { createGrantOwnerAccess } from '@avito/domain';
import { createUserAccessStore } from '../infrastructure/persistence.js';
import { readConfig } from '../config/index.js';

const config = readConfig();
const database = createDatabaseClient(config.DATABASE_URL);
try {
  const telegramId = process.argv[2] ?? '';
  const grantOwnerAccess = createGrantOwnerAccess(
    createUserAccessStore(database).grantOwner,
  );
  await grantOwnerAccess({ telegramId, correlationId: randomUUID() });
  console.log('Owner access granted. Reopen the Mini App.');
} catch {
  console.error(
    'Owner setup failed. Use pnpm telegram:owner <numeric-user-id> and check the database.',
  );
  process.exitCode = 1;
} finally {
  await database.pool.end();
}
