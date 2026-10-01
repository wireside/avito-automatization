import { describe, expect, it } from 'vitest';

import {
  assertIntegrationOperationTransition,
  canTransitionIntegrationOperation,
} from './integration-operation.js';

describe('integration operation transitions', () => {
  it('allows a retryable operation to run again', () => {
    expect(
      canTransitionIntegrationOperation('RETRY_SCHEDULED', 'RUNNING'),
    ).toBe(true);
  });

  it('keeps a successful operation terminal', () => {
    expect(() =>
      assertIntegrationOperationTransition('SUCCEEDED', 'RUNNING'),
    ).toThrow(/Invalid integration operation transition/);
  });
});
