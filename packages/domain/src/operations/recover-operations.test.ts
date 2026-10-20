import { describe, expect, it, vi } from 'vitest';
import { createRecoverOperations } from './recover-operations.js';

describe('operation recovery', () => {
  it('recovers from durable IDs and keeps independent jobs moving after one enqueue failure', async () => {
    const enqueue = vi
      .fn<(operationId: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    const recover = createRecoverOperations({
      listPendingIds: () => Promise.resolve(['first', 'second']),
      enqueue,
    });
    expect(await recover()).toEqual([
      { operationId: 'first', enqueued: false },
      { operationId: 'second', enqueued: true },
    ]);
    expect(enqueue.mock.calls).toEqual([['first'], ['second']]);
  });
});
