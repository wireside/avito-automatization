import { describe, it, expect, vi } from 'vitest';
import {
  dispatchDeadline,
  legalBlockers,
  createMarkingPipeline,
  type PipelineStore,
} from './pipeline.js';
describe('warehouse legal policy', () => {
  it('uses explicit working days and the earlier actual delivery', () => {
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
  it('requires fresh provider evidence, ownership and legal receipt', () => {
    const u = {
      physicalState: 'AVAILABLE',
      legalState: 'IN_CIRCULATION',
      ownership: 'VERIFIED',
      receivedLegally: true,
      observedAt: '2026-11-04T10:00:00Z',
      pending: false,
    };
    expect(legalBlockers(u, new Date('2026-11-04T10:05:00Z'))).toEqual([]);
    expect(
      legalBlockers(
        { ...u, pending: true, ownership: 'UNKNOWN', receivedLegally: false },
        new Date('2026-11-04T10:16:00Z'),
      ),
    ).toEqual(
      expect.arrayContaining([
        'OWNERSHIP_NOT_VERIFIED',
        'LEGAL_OPERATION_PENDING',
        'LEGAL_CHECK_STALE',
        'SUPPLY_NOT_CONFIRMED',
      ]),
    );
  });
  it('allows local setup without external writes and authorizes destructive commands', async () => {
    const store = {
      execute: vi.fn().mockResolvedValue({ ok: true }),
      read: vi.fn(),
      reconcile: vi.fn(),
    } satisfies PipelineStore;
    const user = {
      id: 'a',
      telegramId: '1',
      displayName: null,
      roles: ['WAREHOUSE'],
    };
    await expect(
      createMarkingPipeline(store).command(user, 'dispose', { requestId: 'r' }),
    ).rejects.toThrow('FORBIDDEN');
    await createMarkingPipeline(store).command(
      { ...user, roles: ['OWNER'] },
      'configure',
      { requestId: 'r' },
    );
    expect(store.execute).toHaveBeenCalledOnce();
  });
});
