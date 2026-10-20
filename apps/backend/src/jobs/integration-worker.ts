import { Worker, type WorkerOptions } from 'bullmq';
import {
  calculateRetryDelay,
  INTEGRATION_QUEUE_NAME,
  type IntegrationJobData,
} from '@avito/queue';

export function createIntegrationWorker(
  connection: WorkerOptions['connection'],
  processOperation: (operationId: string) => Promise<void>,
) {
  return new Worker<IntegrationJobData>(
    INTEGRATION_QUEUE_NAME,
    (job) => processOperation(job.data.operationId),
    {
      connection,
      concurrency: 5,
      settings: {
        backoffStrategy: (attemptsMade, type) =>
          type === 'operation-exponential'
            ? calculateRetryDelay(attemptsMade)
            : -1,
      },
    },
  );
}
