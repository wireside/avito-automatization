import type { SessionUser } from '../auth/verify-telegram-session.js';

export type PipelineMode = 'disabled' | 'simulation';
export type PipelineAction =
  | 'configure'
  | 'calendar'
  | 'supply'
  | 'check'
  | 'create'
  | 'pack'
  | 'prepare'
  | 'handover'
  | 'deliver'
  | 'cancel'
  | 'return'
  | 'dispose'
  | 'retry'
  | 'correctDocument'
  | 'simulate';
export type PipelineInput = Record<string, unknown> & { requestId: string };
export class PipelineError extends Error {
  constructor(
    public readonly code: string,
    public readonly blockers: string[] = [],
  ) {
    super(code);
    this.name = 'PipelineError';
  }
}
export function requirePipeline(
  condition: unknown,
  code: string,
  blockers: string[] = [],
): asserts condition {
  if (!condition) throw new PipelineError(code, blockers);
}
export interface PipelineSnapshot {
  physicalState: string;
  legalState: string;
  ownership: string;
  receivedLegally: boolean;
  observedAt: string | null;
  pending: boolean;
  simulated: boolean;
}
export function legalBlockers(
  unit: PipelineSnapshot,
  now: Date,
  mode: PipelineMode,
): string[] {
  const blockers: string[] = [];
  if (mode !== 'simulation') blockers.push('LEGAL_PROVIDER_DISABLED');
  if (unit.simulated !== (mode === 'simulation'))
    blockers.push('EVIDENCE_ENVIRONMENT_MISMATCH');
  if (!unit.receivedLegally) blockers.push('SUPPLY_NOT_CONFIRMED');
  if (unit.legalState !== 'IN_CIRCULATION')
    blockers.push('CODE_NOT_IN_CIRCULATION');
  if (unit.ownership !== 'VERIFIED') blockers.push('OWNERSHIP_NOT_VERIFIED');
  if (
    !unit.observedAt ||
    now.getTime() - Date.parse(unit.observedAt) > 15 * 60_000 ||
    Date.parse(unit.observedAt) > now.getTime()
  )
    blockers.push('LEGAL_CHECK_STALE');
  if (unit.pending) blockers.push('LEGAL_OPERATION_PENDING');
  return blockers;
}
/** Complete explicit calendar is required: holidays and working Saturdays cannot be inferred. */
export function dispatchDeadline(
  dispatchedAt: string,
  calendar: Readonly<Record<string, boolean>>,
  deliveredAt?: string,
): string {
  const local = new Date(Date.parse(dispatchedAt) + 3 * 3600_000);
  let remaining = 3;
  for (let days = 0; remaining > 0; days++) {
    requirePipeline(days < 32, 'CALENDAR_INCOMPLETE');
    local.setUTCDate(local.getUTCDate() + 1);
    const key = local.toISOString().slice(0, 10);
    requirePipeline(typeof calendar[key] === 'boolean', 'CALENDAR_INCOMPLETE', [
      key,
    ]);
    if (calendar[key]) remaining--;
  }
  const end = Date.parse(
    local.toISOString().slice(0, 10) + 'T23:59:59.999+03:00',
  );
  return new Date(
    deliveredAt ? Math.min(end, Date.parse(deliveredAt)) : end,
  ).toISOString();
}
export interface PipelineStore {
  execute(
    action: PipelineAction,
    input: PipelineInput,
    actorId: string,
    mode: PipelineMode,
  ): Promise<Record<string, unknown>>;
  read(
    kind:
      | 'overview'
      | 'shipments'
      | 'shipment'
      | 'unit'
      | 'documents'
      | 'document'
      | 'export'
      | 'issues'
      | 'settings',
    id: string | undefined,
    offset: number,
    mode: PipelineMode,
  ): Promise<Record<string, unknown>>;
  run(operationId: string, mode: PipelineMode): Promise<void>;
  reconcile(mode: PipelineMode): Promise<void>;
}
export function createMarkingPipeline(
  store: PipelineStore,
  mode: PipelineMode,
) {
  return {
    mode,
    async command(
      user: SessionUser,
      action: PipelineAction,
      input: PipelineInput,
    ) {
      const privileged = [
        'configure',
        'calendar',
        'supply',
        'dispose',
        'retry',
        'correctDocument',
        'simulate',
      ].includes(action);
      requirePipeline(
        user.roles.some((r) =>
          (privileged
            ? ['OWNER', 'ADMIN']
            : ['OWNER', 'ADMIN', 'WAREHOUSE']
          ).includes(r),
        ),
        'FORBIDDEN',
      );
      // No live mutation adapter exists in this release. Simulation must be enabled explicitly.
      requirePipeline(mode === 'simulation', 'LEGAL_PROVIDER_DISABLED');
      return store.execute(action, input, user.id, mode);
    },
    async read(
      user: SessionUser,
      kind: Parameters<PipelineStore['read']>[0],
      id?: string,
      offset = 0,
    ) {
      requirePipeline(
        user.roles.some((r) =>
          ['OWNER', 'ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'VIEWER'].includes(r),
        ),
        'FORBIDDEN',
      );
      if (kind === 'export')
        requirePipeline(
          user.roles.some((r) => ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(r)),
          'FORBIDDEN',
        );
      return store.read(kind, id, offset, mode);
    },
    execute: (operationId: string) => store.run(operationId, mode),
    reconcile: () => store.reconcile(mode),
  };
}
export type MarkingPipeline = ReturnType<typeof createMarkingPipeline>;
