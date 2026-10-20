import { describe, expect, it, vi } from 'vitest';
import {
  createProcessIntegrationOperation,
  TerminalOperationError,
} from './process-integration-operation.js';
const operation = {
  id: 'op-1',
  operationType: 'system.noop',
  attemptCount: 1,
  maxAttempts: 5,
};
function setup() {
  const store = {
    claim: vi.fn().mockResolvedValue(operation),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const execute = vi.fn().mockResolvedValue(undefined);
  return {
    store,
    execute,
    process: createProcessIntegrationOperation({
      store,
      execute,
      retryDelay: () => 1000,
      now: () => new Date(0),
    }),
  };
}
describe('durable operation use case', () => {
  it('does not execute an operation already claimed or completed', async () => {
    const service = setup();
    service.store.claim.mockResolvedValue(undefined);
    await service.process('op-1');
    expect(service.execute).not.toHaveBeenCalled();
    expect(service.store.complete).not.toHaveBeenCalled();
  });
  it('persists completion after execution', async () => {
    const service = setup();
    await service.process('op-1');
    expect(service.store.complete).toHaveBeenCalledWith('op-1', 1);
    expect(service.store.fail).not.toHaveBeenCalled();
  });
  it('persists the retry schedule before requesting queue retry', async () => {
    const service = setup();
    const error = new Error('transient');
    service.execute.mockRejectedValue(error);
    await expect(service.process('op-1')).rejects.toBe(error);
    expect(service.store.fail).toHaveBeenCalledWith({
      operationId: 'op-1',
      attemptNumber: 1,
      errorCode: 'Error',
      errorClass: 'RETRYABLE',
      retryAt: new Date(1000),
    });
  });
  it('does not retry terminal failures', async () => {
    const service = setup();
    service.execute.mockRejectedValue(new TerminalOperationError());
    await service.process('op-1');
    expect(service.store.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorClass: 'TERMINAL' }),
    );
    expect(service.store.fail.mock.calls[0]?.[0]).not.toHaveProperty('retryAt');
  });
  it('does not exceed the durable attempt limit', async () => {
    const service = setup();
    service.store.claim.mockResolvedValue({ ...operation, attemptCount: 5 });
    service.execute.mockRejectedValue(new Error());
    await service.process('op-1');
    expect(service.store.fail.mock.calls[0]?.[0]).not.toHaveProperty('retryAt');
  });
});
