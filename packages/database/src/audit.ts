import type { Database } from './client.js';
import { auditLog } from './schema.js';

export async function appendAuditLog(
  db: Database,
  entry: typeof auditLog.$inferInsert,
): Promise<void> {
  await db.insert(auditLog).values(entry);
}
