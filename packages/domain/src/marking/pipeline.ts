import type { SessionUser } from '../auth/verify-telegram-session.js';

export type PipelineAction =
  | 'calendar'
  | 'supply'
  | 'check'
  | 'create'
  | 'importOrder'
  | 'pack'
  | 'prepare'
  | 'handover'
  | 'deliver'
  | 'cancel'
  | 'return'
  | 'dispose'
  | 'retry'
  | 'correctDocument';
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
}
export function legalBlockers(unit: PipelineSnapshot, now: Date): string[] {
  const blockers: string[] = [];
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
  ): Promise<Record<string, unknown>>;
  read(
    kind:
      | 'integrations'
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
  ): Promise<Record<string, unknown>>;

  reconcile(): Promise<void>;
}
export function createMarkingPipeline(
  store: PipelineStore,
  options: {
    validateShipment?: (
      action: 'pack' | 'prepare' | 'handover',
      input: PipelineInput,
    ) => Promise<void>;
    importOrder?: (input: PipelineInput) => Promise<PipelineInput>;
  } = {},
) {
  return {
    async command(
      user: SessionUser,
      action: PipelineAction,
      input: PipelineInput,
    ) {
      const privileged = [
        'calendar',
        'supply',
        'dispose',
        'retry',
        'correctDocument',
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
      if (action === 'importOrder') {
        requirePipeline(options.importOrder, 'AVITO_NOT_CONFIGURED');
        const imported = await options.importOrder(input);
        if (imported.existingShipmentId)
          return {
            ok: true,
            replayed: true,
            result: { shipmentId: imported.existingShipmentId },
          };
        return store.execute('create', imported, user.id);
      }
      if (
        (action === 'pack' || action === 'prepare' || action === 'handover') &&
        !(action === 'handover' && input.occurredOutsideApp === true)
      )
        await options.validateShipment?.(action, input);
      return store.execute(action, input, user.id);
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
      return store.read(kind, id, offset);
    },
    reconcile: () => store.reconcile(),
  };
}
export type MarkingPipeline = ReturnType<typeof createMarkingPipeline>;
