import {
  claimIntegrationOperation,
  completeIntegrationOperation,
  createDatabaseClient,
  failIntegrationOperation,
  listEnqueueableOperationIds,
} from '@avito/database';
import { createLogger } from '@avito/observability';
import {
  calculateRetryDelay,
  createIntegrationQueue,
  createRedisConnection,
  enqueueIntegrationOperation,
  INTEGRATION_QUEUE_NAME,
  type IntegrationJobData,
} from '@avito/queue';
import { Worker } from 'bullmq';

import { readConfig } from './config.js';

const config = readConfig();
const logger = createLogger(config.LOG_LEVEL);
const database = createDatabaseClient(config.DATABASE_URL);
const queueConnection = createRedisConnection(config.REDIS_URL);
const workerConnection = createRedisConnection(config.REDIS_URL);
const queue = createIntegrationQueue(queueConnection);

class TerminalOperationError extends Error {}

const worker = new Worker<IntegrationJobData>(
  INTEGRATION_QUEUE_NAME,
  async (job) => {
    const operation = await claimIntegrationOperation(
      database.db,
      job.data.operationId,
    );
    if (!operation) return;

    try {
      switch (operation.operationType) {
        case 'system.noop':
          break;
        default:
          throw new TerminalOperationError(
            `No handler registered for ${operation.operationType}`,
          );
      }
      await completeIntegrationOperation(
        database.db,
        operation.id,
        operation.attemptCount,
      );
    } catch (error) {
      const retryable = !(error instanceof TerminalOperationError);
      const canRetry =
        retryable && operation.attemptCount < operation.maxAttempts;
      const retryAt = canRetry
        ? new Date(Date.now() + calculateRetryDelay(operation.attemptCount))
        : undefined;
      await failIntegrationOperation(database.db, {
        operationId: operation.id,
        attemptNumber: operation.attemptCount,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        errorClass: retryable ? 'RETRYABLE' : 'TERMINAL',
        ...(retryAt ? { retryAt } : {}),
      });
      if (canRetry) throw error;
    }
  },
  {
    connection: workerConnection,
    concurrency: 5,
    settings: {
      backoffStrategy: (attemptsMade, type) =>
        type === 'operation-exponential'
          ? calculateRetryDelay(attemptsMade)
          : -1,
    },
  },
);

worker.on('completed', (job) => {
  logger.info(
    { operationId: job.data.operationId },
    'Integration operation completed',
  );
});
worker.on('failed', (job, error) => {
  logger.error(
    { error, operationId: job?.data.operationId },
    'Integration operation attempt failed',
  );
});

const recoverOperations = async () => {
  const operationIds = await listEnqueueableOperationIds(database.db);
  await Promise.all(
    operationIds.map((operationId) =>
      enqueueIntegrationOperation(queue, operationId).catch(
        (error: unknown) => {
          logger.error(
            { error, operationId },
            'Could not enqueue durable operation',
          );
        },
      ),
    ),
  );
};

await recoverOperations();
const recoveryTimer = setInterval(() => void recoverOperations(), 30_000);
recoveryTimer.unref();

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down worker');
  clearInterval(recoveryTimer);
  await Promise.all([worker.close(), queue.close()]);
  await Promise.all([
    queueConnection.quit(),
    workerConnection.quit(),
    database.pool.end(),
  ]);
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

logger.info('Integration worker started');
