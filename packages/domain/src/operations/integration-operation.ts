export const integrationOperationStatuses = [
  'PENDING',
  'RUNNING',
  'RETRY_SCHEDULED',
  'SUCCEEDED',
  'MANUAL_ATTENTION',
  'CANCELLED',
] as const;

export type IntegrationOperationStatus =
  (typeof integrationOperationStatuses)[number];

const allowedTransitions: Record<
  IntegrationOperationStatus,
  readonly IntegrationOperationStatus[]
> = {
  PENDING: ['RUNNING', 'CANCELLED'],
  RUNNING: ['RETRY_SCHEDULED', 'SUCCEEDED', 'MANUAL_ATTENTION'],
  RETRY_SCHEDULED: ['RUNNING', 'CANCELLED'],
  SUCCEEDED: [],
  MANUAL_ATTENTION: ['PENDING', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransitionIntegrationOperation(
  from: IntegrationOperationStatus,
  to: IntegrationOperationStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertIntegrationOperationTransition(
  from: IntegrationOperationStatus,
  to: IntegrationOperationStatus,
): void {
  if (!canTransitionIntegrationOperation(from, to)) {
    throw new Error(
      `Invalid integration operation transition: ${from} -> ${to}`,
    );
  }
}

/** Source states are derived from the transition policy, including for SQL guards. */
export function getIntegrationOperationSourceStatuses(
  target: IntegrationOperationStatus,
): IntegrationOperationStatus[] {
  return integrationOperationStatuses.filter((source) =>
    canTransitionIntegrationOperation(source, target),
  );
}

export function canRetryIntegrationOperation(input: {
  attemptCount: number;
  maxAttempts: number;
  terminalFailure: boolean;
}): boolean {
  return !input.terminalFailure && input.attemptCount < input.maxAttempts;
}
