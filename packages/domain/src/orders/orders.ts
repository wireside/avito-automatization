import type { SessionUser } from '../auth/verify-telegram-session.js';

export const avitoOrderStatuses = [
  'on_confirmation',
  'ready_to_ship',
  'in_transit',
  'canceled',
  'delivered',
  'on_return',
  'in_dispute',
  'closed',
] as const;
export interface OrderQuery {
  page: number;
  limit: number;
  status?: (typeof avitoOrderStatuses)[number] | undefined;
}
export interface MarketplaceOrder {
  id: string;
  marketplaceId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  items: {
    avitoId: string;
    title: string;
    quantity: number;
    priceMinor: number | null;
    imageUrl?: string | null;
  }[];
  priceMinor: number | null;
  schedules: { confirmTill: string | null; shipTill: string | null };
  delivery: {
    serviceName: string | null;
    serviceType: string | null;
    trackingNumber: string | null;
    dispatchNumber: string | null;
  };
  availableActions: { name: string; required: boolean }[];
}
export type OrdersFailure = {
  ok: false;
  code:
    | 'FORBIDDEN'
    | 'AVITO_NOT_CONFIGURED'
    | 'AVITO_ACCESS_DENIED'
    | 'AVITO_UNAVAILABLE'
    | 'AVITO_RATE_LIMITED'
    | 'ORDER_NOT_FOUND'
    | 'ORDER_ACTIONS_DISABLED';
};
export type OrdersPage = {
  orders: MarketplaceOrder[];
  hasMore: boolean;
  fetchedAt: string;
  mode: 'read_only';
};
export interface OrderReader {
  list(query: OrderQuery): Promise<({ ok: true } & OrdersPage) | OrdersFailure>;
  get(id: string): Promise<
    | {
        ok: true;
        order: MarketplaceOrder;
        fetchedAt: string;
        mode: 'read_only';
      }
    | OrdersFailure
  >;
}
const canRead = (user: SessionUser) =>
  user.roles.some((role) =>
    ['OWNER', 'ADMIN', 'WAREHOUSE', 'ACCOUNTANT', 'VIEWER'].includes(role),
  );
/** Observation only: no local order intake, inventory reservation, jobs or provider writes. */
export function createReadOrders(reader: OrderReader) {
  return {
    list(user: SessionUser, query: OrderQuery) {
      if (!canRead(user))
        return Promise.resolve({ ok: false, code: 'FORBIDDEN' } as const);
      return reader.list(query);
    },
    get(user: SessionUser, id: string) {
      if (!canRead(user))
        return Promise.resolve({ ok: false, code: 'FORBIDDEN' } as const);
      return reader.get(id);
    },
    confirm(user: SessionUser): OrdersFailure {
      if (
        !user.roles.some((role) =>
          ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(role),
        )
      )
        return { ok: false, code: 'FORBIDDEN' };
      // Deliberately no mutation dependency. A future activation needs a separate durable scenario.
      return { ok: false, code: 'ORDER_ACTIONS_DISABLED' };
    },
  };
}
export type ReadOrders = ReturnType<typeof createReadOrders>;
