import {
  createMarkingProtector,
  createMarkingUnprotector,
} from '../infrastructure/marking-protection.js';
import { createMarkingPipelineStore } from '@avito/database';
import { createMarkingPipeline, executeSystemOperation } from '@avito/domain';
import { createDatabaseClient } from '@avito/database';
import { createLogger } from '@avito/observability';
import {
  calculateRetryDelay,
  createIntegrationQueue,
  createRedisConnection,
  enqueueIntegrationOperation,
} from '@avito/queue';
import type { AppConfig } from '../config/index.js';
import {
  createProcessIntegrationOperation,
  createRecoverOperations,
} from '@avito/domain';
import { createOperationStore } from '../infrastructure/persistence.js';
import { createIntegrationWorker } from '../jobs/integration-worker.js';

export function createWorkerRuntime(config: AppConfig) {
  const logger = createLogger(config.LOG_LEVEL);
  const database = createDatabaseClient(config.DATABASE_URL);
  const queueConnection = createRedisConnection(config.REDIS_URL);
  const workerConnection = createRedisConnection(config.REDIS_URL);
  const queue = createIntegrationQueue(queueConnection);
  const store = createOperationStore(database);
  const pipeline = createMarkingPipeline(
    createMarkingPipelineStore(
      database.db,
      config.MARKING_ENCRYPTION_KEY
        ? {
            encrypt: createMarkingProtector(
              config.MARKING_ENCRYPTION_KEY,
              config.MARKING_ENCRYPTION_KEY_ID,
            ),
            decrypt: createMarkingUnprotector(
              config.MARKING_ENCRYPTION_KEY,
              config.MARKING_ENCRYPTION_KEY_ID,
            ),
          }
        : undefined,
    ),
    config.MARKING_PIPELINE_MODE,
  );
  const worker = createIntegrationWorker(
    workerConnection,
    createProcessIntegrationOperation({
      store,
      retryDelay: calculateRetryDelay,
      execute: (operation) =>
        operation.operationType.startsWith('pipeline.')
          ? pipeline.execute(operation.id)
          : executeSystemOperation(operation),
    }),
  );
  worker.on('completed', (job) =>
    logger.info(
      { operationId: job.data.operationId },
      'Integration operation completed',
    ),
  );
  worker.on('failed', (job, error) =>
    logger.error(
      { errorClass: error.name, operationId: job?.data.operationId },
      'Integration operation attempt failed',
    ),
  );
  const recover = createRecoverOperations({
    listPendingIds: store.listPendingIds,
    enqueue: (operationId) => enqueueIntegrationOperation(queue, operationId),
  });
  const recoverOperations = async () => {
    for (const result of await recover()) {
      if (!result.enqueued)
        logger.error(
          { operationId: result.operationId },
          'Could not enqueue durable operation',
        );
    }
  };
  let recoveryTimer: ReturnType<typeof setInterval> | undefined;
  let closing: Promise<void> | undefined;
  return {
    logger,
    async start() {
      await pipeline.reconcile();
      await recoverOperations();
      recoveryTimer = setInterval(() => {
        void pipeline
          .reconcile()
          .then(recoverOperations)
          .catch(() => logger.error('Durable operation recovery failed'));
      }, 30_000);
      recoveryTimer.unref();
      logger.info('Integration worker started');
    },
    close() {
      closing ??= (async () => {
        clearInterval(recoveryTimer);
        await Promise.all([worker.close(), queue.close()]);
        await Promise.all([
          queueConnection.quit(),
          workerConnection.quit(),
          database.pool.end(),
        ]);
      })();
      return closing;
    },
  };
}
