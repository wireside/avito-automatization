import { describe, it, expect, vi } from 'vitest';
import {
  dispatchDeadline,
  legalBlockers,
  createMarkingPipeline,
  type PipelineStore,
} from './pipeline.js';
describe('marking policies', () => {
  it('uses explicit Russian working days including transferred weekends and earliest delivery', () => {
    const days = {
      '2026-11-05': true,
      '2026-11-06': true,
      '2026-11-07': false,
      '2026-11-08': false,
      '2026-11-09': true,
    };
    expect(dispatchDeadline('2026-11-04T20:00:00Z', days)).toBe(
      '2026-11-09T20:59:59.999Z',
    );
    expect(
      dispatchDeadline('2026-11-04T20:00:00Z', days, '2026-11-06T08:00:00Z'),
    ).toBe('2026-11-06T08:00:00.000Z');
    expect(() => dispatchDeadline('2026-11-04T20:00:00Z', {})).toThrow(
      'CALENDAR_INCOMPLETE',
    );
  });
  it('rejects stale, unknown ownership, pending, and cross-environment evidence', () => {
    const base = {
      physicalState: 'AVAILABLE',
      legalState: 'IN_CIRCULATION',
      ownership: 'VERIFIED',
      receivedLegally: true,
      observedAt: '2026-11-04T10:00:00Z',
      pending: false,
      simulated: true,
    };
    expect(
      legalBlockers(base, new Date('2026-11-04T10:05:00Z'), 'simulation'),
    ).toEqual([]);
    expect(
      legalBlockers(
        { ...base, pending: true, ownership: 'UNKNOWN' },
        new Date('2026-11-04T10:16:00Z'),
        'simulation',
      ),
    ).toEqual(
      expect.arrayContaining([
        'OWNERSHIP_NOT_VERIFIED',
        'LEGAL_OPERATION_PENDING',
        'LEGAL_CHECK_STALE',
      ]),
    );
    expect(
      legalBlockers(base, new Date('2026-11-04T10:05:00Z'), 'disabled'),
    ).toContain('EVIDENCE_ENVIRONMENT_MISMATCH');
  });
  it('enforces roles and refuses external mutation mode', async () => {
    const store = {
      execute: vi.fn(),
      read: vi.fn(),
      run: vi.fn(),
      reconcile: vi.fn(),
    } satisfies PipelineStore;
    const user = {
      id: 'a',
      telegramId: '1',
      displayName: null,
      roles: ['WAREHOUSE'],
    };
    await expect(
      createMarkingPipeline(store, 'simulation').command(user, 'dispose', {
        requestId: 'r',
      }),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      createMarkingPipeline(store, 'disabled').command(
        { ...user, roles: ['OWNER'] },
        'create',
        { requestId: 'r' },
      ),
    ).rejects.toThrow('LEGAL_PROVIDER_DISABLED');
    expect(store.execute).not.toHaveBeenCalled();
  });
});
