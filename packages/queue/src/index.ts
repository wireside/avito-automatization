import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

export const INTEGRATION_QUEUE_NAME = 'integration-operations';

export interface IntegrationJobData {
  operationId: string;
}

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  });
}

export function createIntegrationQueue(connection: Redis) {
  return new Queue<IntegrationJobData>(INTEGRATION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'operation-exponential' },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
}

export async function enqueueIntegrationOperation(
  queue: Queue<IntegrationJobData>,
  operationId: string,
  options: JobsOptions = {},
): Promise<void> {
  await queue.add(
    'execute',
    { operationId },
    { jobId: `operation-${operationId}`, ...options },
  );
}

export function calculateRetryDelay(attemptsMade: number): number {
  const exponential = Math.min(
    30_000,
    1_000 * 2 ** Math.max(0, attemptsMade - 1),
  );
  const jitter = Math.floor(exponential * 0.2 * Math.random());
  return exponential + jitter;
}
