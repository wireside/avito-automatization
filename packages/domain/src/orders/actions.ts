import type { SessionUser } from '../auth/verify-telegram-session.js';
import type { MarketplaceOrder, OrderReader } from './orders.js';
import { ProviderError } from '../marking/provider.js';
import { requirePipeline } from '../marking/pipeline.js';
export type AvitoAction =
  | 'confirm'
  | 'reject'
  | 'perform'
  | 'receive'
  | 'setTrackNumber'
  | 'fixTrackNumber'
  | 'acceptReturnOrder'
  | 'setCNCDetails'
  | 'setCourierDeliveryRange'
  | 'label';
export interface AvitoActionCommand {
  requestId: string;
  action: AvitoAction;
  data: Record<string, string | number | undefined>;
}
export interface AvitoActionView {
  id: string;
  action: AvitoAction;
  status: string;
  errorCode: string | null;
  createdAt: string;
  labelReady: boolean;
  reconcilable: boolean;
}
export interface AvitoActionWork {
  id: string;
  orderId: string;
  command: AvitoActionCommand;
  started: boolean;
  result: { labelTaskId?: string } | null;
}
export interface AvitoActionStore {
  enqueue(
    orderId: string,
    command: AvitoActionCommand,
    actorId: string,
  ): Promise<{ operationId: string; replayed: boolean }>;
  list(orderId: string): Promise<AvitoActionView[]>;
  load(id: string): Promise<AvitoActionWork>;
  start(id: string): Promise<void>;
  reset(id: string): Promise<void>;
  reconcile(id: string, orderId: string): Promise<void>;
  finish(id: string, result: { labelTaskId?: string }): Promise<void>;
}
export interface CourierOptions {
  address?: string | undefined;
  addressDetails?: string | undefined;
  name?: string | undefined;
  phone?: string | undefined;
  dateOptions: {
    date: string;
    timeIntervals: {
      startDate: string;
      endDate: string;
      title: string;
      type: string;
    }[];
  }[];
}
export interface AvitoActionProvider {
  execute(
    order: MarketplaceOrder,
    command: AvitoActionCommand,
    beforeSend: () => Promise<void>,
  ): Promise<{ labelTaskId?: string }>;
  courier(orderId: string, address?: string): Promise<CourierOptions>;
  download(taskId: string): Promise<Uint8Array>;
}
const canWrite = (user: SessionUser) =>
  user.roles.some((r) => ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(r));
const canRead = (user: SessionUser) =>
  user.roles.some((r) =>
    ['OWNER', 'ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'VIEWER'].includes(r),
  );
export function assertAvitoActionAvailable(
  order: MarketplaceOrder,
  action: AvitoAction,
) {
  requirePipeline(
    action === 'label'
      ? order.delivery.serviceType === 'pvz' &&
          !!order.marketplaceId &&
          !['canceled', 'closed'].includes(order.status)
      : action === 'setCourierDeliveryRange'
        ? ['on_confirmation', 'ready_to_ship'].includes(order.status)
        : order.availableActions.some((a) => a.name === action),
    'ORDER_ACTION_UNAVAILABLE',
  );
}
export async function readCurrentOrder(reader: OrderReader, id: string) {
  const result = await reader.get(id);
  if (!result.ok)
    throw new ProviderError(
      result.code,
      ['AVITO_RATE_LIMITED', 'AVITO_UNAVAILABLE'].includes(result.code),
    );
  requirePipeline(result.order.id === id, 'ORDER_RESPONSE_MISMATCH');
  return result.order;
}
/** Match an exact provider fact. Never infer acceptance solely from a missing button. */
export function avitoActionObserved(
  order: MarketplaceOrder,
  command: AvitoActionCommand,
) {
  switch (command.action) {
    case 'confirm':
      return ['ready_to_ship', 'in_transit', 'delivered', 'closed'].includes(
        order.status,
      );
    case 'reject':
      return order.status === 'canceled';
    case 'perform':
      return ['in_transit', 'delivered', 'closed'].includes(order.status);
    case 'receive':
      return ['delivered', 'closed'].includes(order.status);
    case 'setTrackNumber':
    case 'fixTrackNumber':
      return order.delivery.trackingNumber === command.data.trackingNumber;
    default:
      return false;
  }
}
export function createAvitoOrderActions(deps: {
  store: AvitoActionStore;
  reader: OrderReader;
  provider: AvitoActionProvider;
  writesEnabled: boolean;
}) {
  return {
    async enqueue(
      user: SessionUser,
      orderId: string,
      command: AvitoActionCommand,
    ) {
      requirePipeline(canWrite(user), 'FORBIDDEN');
      requirePipeline(deps.writesEnabled, 'ORDER_ACTIONS_DISABLED');
      // The durable executor checks fresh availableActions immediately before sending.
      return deps.store.enqueue(orderId, command, user.id);
    },
    async list(user: SessionUser, orderId: string) {
      requirePipeline(canRead(user), 'FORBIDDEN');
      return {
        writesEnabled: deps.writesEnabled,
        operations: await deps.store.list(orderId),
      };
    },
    async reconcile(user: SessionUser, orderId: string, id: string) {
      requirePipeline(canWrite(user), 'FORBIDDEN');
      await deps.store.reconcile(id, orderId);
      return { operationId: id };
    },
    async courier(user: SessionUser, id: string, address?: string) {
      requirePipeline(canWrite(user), 'FORBIDDEN');
      assertAvitoActionAvailable(
        await readCurrentOrder(deps.reader, id),
        'setCourierDeliveryRange',
      );
      return deps.provider.courier(id, address);
    },
    async download(user: SessionUser, orderId: string, id: string) {
      requirePipeline(canRead(user), 'FORBIDDEN');
      const work = await deps.store.load(id);
      requirePipeline(
        work.orderId === orderId &&
          work.command.action === 'label' &&
          work.result?.labelTaskId,
        'ORDER_ACTION_UNAVAILABLE',
      );
      return deps.provider.download(work.result.labelTaskId);
    },
  };
}
export type AvitoOrderActions = ReturnType<typeof createAvitoOrderActions>;
/** The start barrier is committed before I/O. A process death never causes a blind second write. */
export function createExecuteAvitoAction(deps: {
  store: AvitoActionStore;
  reader: OrderReader;
  provider: AvitoActionProvider;
  writesEnabled: boolean;
}) {
  return async (id: string) => {
    const work = await deps.store.load(id);
    if (work.result) return;
    const order = await readCurrentOrder(deps.reader, work.orderId);
    if (work.started) {
      if (avitoActionObserved(order, work.command)) {
        await deps.store.finish(id, {});
        return;
      }
      throw new ProviderError('AVITO_ACTION_RESULT_UNKNOWN', false, true);
    }
    requirePipeline(deps.writesEnabled, 'ORDER_ACTIONS_DISABLED');
    assertAvitoActionAvailable(order, work.command.action);
    if (work.command.action === 'setCourierDeliveryRange') {
      const d = work.command.data;
      const available = await deps.provider.courier(
        work.orderId,
        String(d.address),
      );
      requirePipeline(
        available.dateOptions.some((day) =>
          day.timeIntervals.some(
            (i) =>
              i.startDate === d.startDate &&
              i.endDate === d.endDate &&
              i.type === d.intervalType,
          ),
        ),
        'ORDER_ACTION_UNAVAILABLE',
      );
    }
    if (work.command.action === 'setCNCDetails')
      requirePipeline(order.marketplaceId, 'ORDER_ACTION_UNAVAILABLE');
    // Acquire credentials/budget in the adapter before setting the durable network barrier.
    try {
      const result = await deps.provider.execute(order, work.command, () =>
        deps.store.start(id),
      );
      await deps.store.finish(id, result);
    } catch (error) {
      if (error instanceof ProviderError && !error.ambiguous)
        await deps.store.reset(id);
      throw error;
    }
  };
}
