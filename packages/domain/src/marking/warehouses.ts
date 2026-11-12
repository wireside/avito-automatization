import type { SessionUser } from '../auth/verify-telegram-session.js';
import { canReadStock } from '../inventory/inventory.js';
import { requirePipeline } from './pipeline.js';

export interface WarehouseSummary {
  id: string;
  name: string;
  isDefault: boolean;
  address: string | null;
  configured: boolean;
}
export interface ChzConnection {
  sellerInn: string | null;
  canChangeInn: boolean;
  signerActive: boolean;
  authorized: boolean;
}
export interface ChzPlace {
  fiasId: string;
  address: string;
}
export interface WarehouseSave {
  requestId: string;
  warehouseId?: string | undefined;
  name: string;
  fiasId: string;
}
export interface WarehouseSettingsStore {
  list(): Promise<WarehouseSummary[]>;
  connection(): Promise<ChzConnection>;
  connect(inn: string, actorId: string): Promise<void>;
  replay(
    input: WarehouseSave,
    actorId: string,
  ): Promise<{ warehouseId: string } | null>;
  save(
    input: WarehouseSave,
    place: ChzPlace,
    inn: string,
    actorId: string,
  ): Promise<{ warehouseId: string }>;
}
export function createWarehouseSettings(deps: {
  store: WarehouseSettingsStore;
  places: (
    inn: string,
  ) => Promise<{ items: ChzPlace[]; incompleteCount: number }>;
}) {
  const manage = (user: SessionUser) =>
    requirePipeline(
      user.roles.some((r) => ['OWNER', 'ADMIN'].includes(r)),
      'FORBIDDEN',
    );
  async function places() {
    const connection = await deps.store.connection();
    requirePipeline(connection.sellerInn, 'SELLER_NOT_CONFIGURED');
    return {
      sellerInn: connection.sellerInn,
      ...(await deps.places(connection.sellerInn)),
    };
  }
  return {
    async list(user: SessionUser) {
      requirePipeline(canReadStock(user.roles), 'FORBIDDEN');
      return { ok: true as const, items: await deps.store.list() };
    },
    async connection(user: SessionUser) {
      manage(user);
      return { ok: true as const, ...(await deps.store.connection()) };
    },
    async connect(user: SessionUser, sellerInn: string) {
      manage(user);
      requirePipeline(/^\d{12}$/.test(sellerInn), 'INVALID_SELLER_INN');
      await deps.store.connect(sellerInn, user.id);
      return { ok: true as const, ...(await deps.store.connection()) };
    },
    async places(user: SessionUser) {
      manage(user);
      return { ok: true as const, ...(await places()) };
    },
    async save(user: SessionUser, input: WarehouseSave) {
      manage(user);
      const replay = await deps.store.replay(input, user.id);
      if (replay) return { ok: true as const, ...replay };
      // Never accept an address or seller identity supplied by the browser.
      const current = await places();
      const place = current.items.find((p) => p.fiasId === input.fiasId);
      requirePipeline(place, 'CHZ_PLACE_NOT_FOUND');
      return {
        ok: true as const,
        ...(await deps.store.save(input, place, current.sellerInn, user.id)),
      };
    },
  };
}
export type WarehouseSettings = ReturnType<typeof createWarehouseSettings>;
