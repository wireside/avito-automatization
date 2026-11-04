import { getIntegrationOperationSourceStatuses } from '@avito/domain';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { integrationAttempts, integrationOperations } from './schema.js';

export interface CreateIntegrationOperationInput {
  operationType: string;
  idempotencyKey: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
  correlationId: string;
  maxAttempts?: number;
}

export async function createIntegrationOperation(
  db: Database,
  input: CreateIntegrationOperationInput,
) {
  const [created] = await db
    .insert(integrationOperations)
    .values({
      ...input,
      payload: input.payload ?? {},
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: integrationOperations.idempotencyKey })
    .returning();

  if (created) return created;

  const [existing] = await db
    .select()
    .from(integrationOperations)
    .where(eq(integrationOperations.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (!existing) throw new Error('Idempotent operation lookup failed');
  return existing;
}

export async function claimIntegrationOperation(
  db: Database,
  operationId: string,
) {
  return db.transaction(async (tx) => {
    const [operation] = await tx
      .update(integrationOperations)
      .set({
        status: 'RUNNING',
        attemptCount: sql`${integrationOperations.attemptCount} + 1`,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationOperations.id, operationId),
          inArray(
            integrationOperations.status,
            getIntegrationOperationSourceStatuses('RUNNING'),
          ),
          sql`${integrationOperations.attemptCount} < ${integrationOperations.maxAttempts}`,
          or(
            isNull(integrationOperations.nextAttemptAt),
            lte(integrationOperations.nextAttemptAt, new Date()),
          ),
        ),
      )
      .returning();

    if (!operation) return undefined;

    await tx.insert(integrationAttempts).values({
      operationId: operation.id,
      attemptNumber: operation.attemptCount,
    });

    return operation;
  });
}

export async function completeIntegrationOperation(
  db: Database,
  operationId: string,
  attemptNumber: number,
  responseMetadata?: Record<string, unknown>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(integrationOperations)
      .set({
        status: 'SUCCEEDED',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationOperations.id, operationId),
          eq(integrationOperations.attemptCount, attemptNumber),
          eq(integrationOperations.status, 'RUNNING'),
        ),
      );
    await tx
      .update(integrationAttempts)
      .set({ outcome: 'SUCCEEDED', responseMetadata, finishedAt: new Date() })
      .where(
        and(
          eq(integrationAttempts.operationId, operationId),
          eq(integrationAttempts.attemptNumber, attemptNumber),
          eq(integrationAttempts.outcome, 'RUNNING'),
        ),
      );
  });
}

export async function failIntegrationOperation(
  db: Database,
  input: {
    operationId: string;
    attemptNumber: number;
    errorCode: string;
    errorClass: string;
    retryAt?: Date;
  },
): Promise<void> {
  const retryable = input.retryAt !== undefined;
  await db.transaction(async (tx) => {
    await tx
      .update(integrationOperations)
      .set({
        status: retryable ? 'RETRY_SCHEDULED' : 'MANUAL_ATTENTION',
        nextAttemptAt: input.retryAt ?? null,
        lastErrorCode: input.errorCode,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationOperations.id, input.operationId),
          eq(integrationOperations.attemptCount, input.attemptNumber),
          eq(integrationOperations.status, 'RUNNING'),
        ),
      );
    await tx
      .update(integrationAttempts)
      .set({
        outcome: retryable ? 'RETRYABLE_FAILURE' : 'TERMINAL_FAILURE',
        errorCode: input.errorCode,
        errorClass: input.errorClass,
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(integrationAttempts.operationId, input.operationId),
          eq(integrationAttempts.attemptNumber, input.attemptNumber),
          eq(integrationAttempts.outcome, 'RUNNING'),
        ),
      );
  });
}

export async function listEnqueueableOperationIds(
  db: Database,
  now = new Date(),
  limit = 100,
): Promise<string[]> {
  const rows = await db
    .select({ id: integrationOperations.id })
    .from(integrationOperations)
    .where(
      and(
        inArray(
          integrationOperations.status,
          getIntegrationOperationSourceStatuses('RUNNING'),
        ),
        or(
          isNull(integrationOperations.nextAttemptAt),
          lte(integrationOperations.nextAttemptAt, now),
        ),
        sql`${integrationOperations.attemptCount} < ${integrationOperations.maxAttempts}`,
      ),
    )
    .orderBy(asc(integrationOperations.createdAt))
    .limit(limit);
  return rows.map(({ id }) => id);
}

/** Recover process death after claim. Provider handlers must reconcile before re-submitting. */
export async function recoverAbandonedOperations(
  db: Database,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(integrationOperations)
      .where(
        and(
          eq(integrationOperations.status, 'RUNNING'),
          lte(
            integrationOperations.startedAt,
            new Date(now.getTime() - 5 * 60_000),
          ),
        ),
      )
      .for('update', { skipLocked: true });
    for (const operation of stale) {
      await tx
        .update(integrationOperations)
        .set({
          status:
            operation.attemptCount < operation.maxAttempts
              ? 'RETRY_SCHEDULED'
              : 'MANUAL_ATTENTION',
          nextAttemptAt: now,
          lastErrorCode: 'WORKER_INTERRUPTED',
          updatedAt: now,
        })
        .where(eq(integrationOperations.id, operation.id));
      await tx
        .update(integrationAttempts)
        .set({
          outcome: 'RETRYABLE_FAILURE',
          errorCode: 'WORKER_INTERRUPTED',
          errorClass: 'RECOVERY',
          finishedAt: now,
        })
        .where(
          and(
            eq(integrationAttempts.operationId, operation.id),
            eq(integrationAttempts.attemptNumber, operation.attemptCount),
            eq(integrationAttempts.outcome, 'RUNNING'),
          ),
        );
    }
  });
}
