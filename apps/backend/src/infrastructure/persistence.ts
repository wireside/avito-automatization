import {
  claimIntegrationOperation,
  completeIntegrationOperation,
  failIntegrationOperation,
  findActiveUserWithRoles,
  grantOwnerAccess,
  listEnqueueableOperationIds,
  type DatabaseClient,
} from '@avito/database';
import type {
  GrantOwnerAccessInput,
  IntegrationOperationStore,
} from '@avito/domain';

export function createUserAccessStore(database: DatabaseClient) {
  return {
    findActiveUser: (telegramId: string) =>
      findActiveUserWithRoles(database.db, telegramId),
    grantOwner: (input: GrantOwnerAccessInput) =>
      grantOwnerAccess(database.db, input.telegramId, input.correlationId),
  };
}

export function createOperationStore(
  database: DatabaseClient,
): IntegrationOperationStore & {
  listPendingIds: () => Promise<string[]>;
} {
  return {
    claim: (operationId) => claimIntegrationOperation(database.db, operationId),
    complete: (operationId, attemptNumber) =>
      completeIntegrationOperation(database.db, operationId, attemptNumber),
    fail: (input) => failIntegrationOperation(database.db, input),
    listPendingIds: () => listEnqueueableOperationIds(database.db),
  };
}
