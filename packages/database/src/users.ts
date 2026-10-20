import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import { auditLog, roles, userRoles, users } from './schema.js';

export async function findActiveUserWithRoles(
  db: Database,
  telegramId: string,
) {
  const rows = await db
    .select({
      id: users.id,
      telegramId: users.telegramId,
      displayName: users.displayName,
      role: roles.name,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.telegramId, telegramId), eq(users.isActive, true)));

  const first = rows[0];
  if (!first) return undefined;
  return {
    id: first.id,
    telegramId: first.telegramId,
    displayName: first.displayName,
    roles: rows.flatMap(({ role }) => (role ? [role] : [])),
  };
}

export async function grantOwnerAccess(
  db: Database,
  telegramId: string,
  correlationId: string,
) {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ telegramId })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: { isActive: true, updatedAt: new Date() },
      })
      .returning();
    const [role] = await tx
      .insert(roles)
      .values({ name: 'OWNER' })
      .onConflictDoUpdate({ target: roles.name, set: { name: 'OWNER' } })
      .returning();
    if (!user || !role) throw new Error('Owner setup failed');
    const granted = await tx
      .insert(userRoles)
      .values({ userId: user.id, roleId: role.id })
      .onConflictDoNothing()
      .returning();
    if (granted.length) {
      await tx.insert(auditLog).values({
        actorType: 'OPERATOR',
        action: 'user.grant-owner',
        entityType: 'user',
        entityId: user.id,
        source: 'local-cli',
        reason: 'Explicit owner bootstrap',
        after: { role: 'OWNER' },
        correlationId,
      });
    }
  });
}
