import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateRetryDelay } from './index.js';

describe('retry policy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses capped exponential backoff with jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(calculateRetryDelay(1)).toBe(1_100);
    expect(calculateRetryDelay(20)).toBe(33_000);
  });
});
