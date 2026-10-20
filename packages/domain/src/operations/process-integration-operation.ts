import { canRetryIntegrationOperation } from './integration-operation.js';

export interface ClaimedOperation {
  id: string;
  operationType: string;
  attemptCount: number;
  maxAttempts: number;
}

export interface FailedOperation {
  operationId: string;
  attemptNumber: number;
  errorCode: string;
  errorClass: string;
  retryAt?: Date;
}

export interface IntegrationOperationStore {
  claim: (operationId: string) => Promise<ClaimedOperation | undefined>;
  complete: (operationId: string, attemptNumber: number) => Promise<void>;
  fail: (input: FailedOperation) => Promise<void>;
}

export class TerminalOperationError extends Error {}

export function executeSystemOperation(
  operation: ClaimedOperation,
): Promise<void> {
  if (operation.operationType !== 'system.noop') {
    return Promise.reject(
      new TerminalOperationError(
        `No handler registered for ${operation.operationType}`,
      ),
    );
  }
  return Promise.resolve();
}

export function createProcessIntegrationOperation(dependencies: {
  store: IntegrationOperationStore;
  retryDelay: (attemptNumber: number) => number;
  execute?: (operation: ClaimedOperation) => Promise<void>;
  now?: () => Date;
}) {
  const execute = dependencies.execute ?? executeSystemOperation;
  const now = dependencies.now ?? (() => new Date());
  return async (operationId: string): Promise<void> => {
    const operation = await dependencies.store.claim(operationId);
    if (!operation) return;
    try {
      await execute(operation);
      await dependencies.store.complete(operation.id, operation.attemptCount);
    } catch (error) {
      const retryable = !(error instanceof TerminalOperationError);
      const canRetry = canRetryIntegrationOperation({
        attemptCount: operation.attemptCount,
        maxAttempts: operation.maxAttempts,
        terminalFailure: !retryable,
      });
      const retryAt = canRetry
        ? new Date(
            now().getTime() + dependencies.retryDelay(operation.attemptCount),
          )
        : undefined;
      await dependencies.store.fail({
        operationId: operation.id,
        attemptNumber: operation.attemptCount,
        errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        errorClass: retryable ? 'RETRYABLE' : 'TERMINAL',
        ...(retryAt ? { retryAt } : {}),
      });
      if (canRetry) throw error;
    }
  };
}
