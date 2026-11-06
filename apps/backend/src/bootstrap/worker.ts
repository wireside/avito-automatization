import { createSignerEnrollmentStore } from '@avito/database';
import { createNotifySigner } from '@avito/domain';
import { createSignerNotificationSender } from '../infrastructure/signer-notification.js';
import { signerApprovalMessage } from '../telegram/signer-message.js';
import { createAvitoReadLimiter } from '../infrastructure/avito-read-limiter.js';
import { createMarkingWorkStore, createChzSessionStore } from '@avito/database';
import { createMarkingExecutor } from '@avito/domain';
import { createTrueApiClient } from '../infrastructure/true-api.js';
import { createAvitoMarkingSender } from '../infrastructure/avito-markings.js';
import { createChzAuthorization } from '../infrastructure/chz-authorization.js';
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
  );
  const protection = config.MARKING_ENCRYPTION_KEY
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
    : undefined;
  const registry = createSignerEnrollmentStore(database.db);
  const sendNotice = createSignerNotificationSender(config.TELEGRAM_BOT_TOKEN);
  const notifySigner = createNotifySigner(registry, (n) =>
    sendNotice(n.telegramId, signerApprovalMessage(n)),
  );
  const sessions = createChzSessionStore(database.db, protection);
  const legal = createTrueApiClient({
    session: sessions,
    submissionsEnabled: config.CHZ_DOCUMENT_SUBMISSION_ENABLED,
  });
  const authorize = createChzAuthorization(
    sessions,
    legal,
    async () =>
      !!(
        !config.SIGNER_TELEGRAM_ENROLLMENT_ENABLED &&
        config.LOCAL_SIGNER_TOKEN &&
        config.LOCAL_SIGNER_CERTIFICATE_THUMBPRINT
      ) ||
      (config.SIGNER_TELEGRAM_ENROLLMENT_ENABLED &&
        (await registry.hasActive())),
  );
  const executeMarking = createMarkingExecutor({
    store: createMarkingWorkStore(database.db, protection),
    legal,
    sendMarkings: createAvitoMarkingSender({
      clientId: config.AVITO_API_CLIENT_ID,
      clientSecret: config.AVITO_API_CLIENT_SECRET,
      writesEnabled: config.AVITO_WRITES_ENABLED,
      acquireSlot: createAvitoReadLimiter(
        queueConnection,
        (config.AVITO_API_CLIENT_ID ?? 'unconfigured') + ':markings',
      ),
    }),
    submissionsEnabled: config.CHZ_DOCUMENT_SUBMISSION_ENABLED,
  });
  const worker = createIntegrationWorker(
    workerConnection,
    createProcessIntegrationOperation({
      store,
      retryDelay: calculateRetryDelay,
      execute: (operation) =>
        operation.operationType.startsWith('pipeline.')
          ? executeMarking(operation.id)
          : operation.operationType === 'signer.notify'
            ? notifySigner(operation.id)
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
      await authorize().catch(() =>
        logger.warn('CHZ authorization is waiting for a configured signer'),
      );
      await pipeline.reconcile();
      await recoverOperations();
      recoveryTimer = setInterval(() => {
        void authorize()
          .catch(() =>
            logger.warn('CHZ authorization is waiting for a configured signer'),
          )
          .then(() => pipeline.reconcile())
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
