export function createRecoverOperations(dependencies: {
  listPendingIds: () => Promise<string[]>;
  enqueue: (operationId: string) => Promise<void>;
}) {
  return async () => {
    const operationIds = await dependencies.listPendingIds();
    return Promise.all(
      operationIds.map(async (operationId) => {
        try {
          await dependencies.enqueue(operationId);
          return { operationId, enqueued: true as const };
        } catch {
          return { operationId, enqueued: false as const };
        }
      }),
    );
  };
}
