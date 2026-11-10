import { describe, it, expect, vi } from 'vitest';
import {
  createAvitoOrderActions,
  createExecuteAvitoAction,
  assertAvitoActionAvailable,
  type AvitoActionStore,
  type AvitoActionProvider,
  type AvitoActionWork,
} from './actions.js';
import type { MarketplaceOrder, OrderReader } from './orders.js';
import { assertCurrentShipment } from './shipment.js';
import { ProviderError } from '../marking/provider.js';
const order: MarketplaceOrder = {
  id: '50000000000000001',
  marketplaceId: '70000000000000001',
  status: 'on_confirmation',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  items: [
    { avitoId: '123', title: 'Trousers', quantity: 1, priceMinor: 240000 },
  ],
  priceMinor: 240000,
  schedules: { confirmTill: null, shipTill: null },
  delivery: {
    serviceName: null,
    serviceType: 'pvz',
    trackingNumber: null,
    dispatchNumber: null,
  },
  availableActions: [{ name: 'confirm', required: true }],
};
const owner = {
  id: 'owner',
  telegramId: '1',
  displayName: null,
  roles: ['OWNER'],
};
function fixture(started = false) {
  const work: AvitoActionWork = {
    id: 'job',
    orderId: order.id,
    command: { requestId: 'request', action: 'confirm', data: {} },
    started,
    result: null,
  };
  const store = {
    enqueue: vi
      .fn<AvitoActionStore['enqueue']>()
      .mockResolvedValue({ operationId: 'job', replayed: false }),
    list: vi.fn<AvitoActionStore['list']>().mockResolvedValue([]),
    load: vi.fn<AvitoActionStore['load']>().mockResolvedValue(work),
    start: vi.fn<AvitoActionStore['start']>().mockImplementation(() => {
      work.started = true;
      return Promise.resolve();
    }),
    reset: vi.fn<AvitoActionStore['reset']>().mockResolvedValue(undefined),
    finish: vi.fn<AvitoActionStore['finish']>().mockResolvedValue(undefined),
    reconcile: vi
      .fn<AvitoActionStore['reconcile']>()
      .mockResolvedValue(undefined),
  } satisfies AvitoActionStore;
  const reader = {
    get: vi.fn<OrderReader['get']>().mockResolvedValue({
      ok: true,
      order,
      mode: 'read_only',
      fetchedAt: new Date().toISOString(),
    }),
    list: vi.fn<OrderReader['list']>(),
  } satisfies OrderReader;
  const provider = {
    execute: vi
      .fn<AvitoActionProvider['execute']>()
      .mockImplementation(async (_o, _c, before) => {
        await before();
        return {};
      }),
    courier: vi.fn<AvitoActionProvider['courier']>(),
    download: vi.fn<AvitoActionProvider['download']>(),
  } satisfies AvitoActionProvider;
  return { work, store, reader, provider, writesEnabled: true };
}
describe('durable Avito seller actions', () => {
  it('rechecks availableActions and commits a network barrier before sending', async () => {
    const f = fixture();
    await createExecuteAvitoAction(f)('job');
    expect(f.store.start).toHaveBeenCalledWith('job');
    expect(f.store.finish).toHaveBeenCalledWith('job', {});
  });
  it('refuses a stale/canceled action without sending or starting', async () => {
    const f = fixture();
    vi.mocked(f.reader.get).mockResolvedValue({
      ok: true,
      order: { ...order, status: 'canceled', availableActions: [] },
      mode: 'read_only',
      fetchedAt: new Date().toISOString(),
    });
    await expect(createExecuteAvitoAction(f)('job')).rejects.toThrow(
      'ORDER_ACTION_UNAVAILABLE',
    );
    expect(f.provider.execute).not.toHaveBeenCalled();
    expect(f.store.start).not.toHaveBeenCalled();
  });
  it('does not repeat an ambiguous write, even if the old action is still available', async () => {
    const f = fixture(true);
    await expect(createExecuteAvitoAction(f)('job')).rejects.toThrow(
      'AVITO_ACTION_RESULT_UNKNOWN',
    );
    expect(f.provider.execute).not.toHaveBeenCalled();
  });
  it('resolves a process crash through exact provider status without another write', async () => {
    const f = fixture(true);
    vi.mocked(f.reader.get).mockResolvedValue({
      ok: true,
      order: { ...order, status: 'ready_to_ship', availableActions: [] },
      mode: 'read_only',
      fetchedAt: new Date().toISOString(),
    });
    await createExecuteAvitoAction(f)('job');
    expect(f.store.finish).toHaveBeenCalledWith('job', {});
    expect(f.provider.execute).not.toHaveBeenCalled();
  });
  it('leaves the barrier intact after a timeout', async () => {
    const f = fixture();
    vi.mocked(f.provider.execute).mockImplementation(async (_o, _c, before) => {
      await before();
      throw new ProviderError('AVITO_ACTION_RESULT_UNKNOWN', false, true);
    });
    await expect(createExecuteAvitoAction(f)('job')).rejects.toThrow(
      'AVITO_ACTION_RESULT_UNKNOWN',
    );
    expect(f.store.reset).not.toHaveBeenCalled();
  });
  it('permits a safe retry only after definite refusal', async () => {
    const f = fixture();
    vi.mocked(f.provider.execute).mockRejectedValue(
      new ProviderError('AVITO_RATE_LIMITED', true),
    );
    await expect(createExecuteAvitoAction(f)('job')).rejects.toThrow();
    expect(f.store.reset).toHaveBeenCalled();
  });
  it('never sends when writes are disabled', async () => {
    const f = { ...fixture(), writesEnabled: false };
    await expect(createExecuteAvitoAction(f)('job')).rejects.toThrow(
      'ORDER_ACTIONS_DISABLED',
    );
    expect(f.provider.execute).not.toHaveBeenCalled();
  });
  it.each(['VIEWER', 'ACCOUNTANT', 'OTHER'])(
    'does not grant writes to %s',
    async (role) => {
      const f = fixture();
      await expect(
        createAvitoOrderActions(f).enqueue(
          { ...owner, roles: [role] },
          order.id,
          f.work.command,
        ),
      ).rejects.toThrow('FORBIDDEN');
      expect(f.store.enqueue).not.toHaveBeenCalled();
    },
  );
  it('rejects download of another order label', async () => {
    const f = fixture();
    f.work.command.action = 'label';
    f.work.result = { labelTaskId: 'task' };
    await expect(
      createAvitoOrderActions(f).download(owner, 'other', 'job'),
    ).rejects.toThrow('ORDER_ACTION_UNAVAILABLE');
    expect(f.provider.download).not.toHaveBeenCalled();
  });
  it('verifies courier intervals server-side before sending', async () => {
    const f = fixture();
    f.work.command = {
      requestId: 'request',
      action: 'setCourierDeliveryRange',
      data: {
        address: 'address',
        startDate: 'date',
        endDate: 'other',
        intervalType: 'fixed',
      },
    };
    vi.mocked(f.provider.courier).mockResolvedValue({ dateOptions: [] });
    await expect(createExecuteAvitoAction(f)('job')).rejects.toThrow(
      'ORDER_ACTION_UNAVAILABLE',
    );
    expect(f.provider.execute).not.toHaveBeenCalled();
  });
  it('limits labels to a known marketplace order and supported delivery', () => {
    expect(() =>
      assertAvitoActionAvailable({ ...order, marketplaceId: null }, 'label'),
    ).toThrow('ORDER_ACTION_UNAVAILABLE');
    expect(() =>
      assertAvitoActionAvailable(
        { ...order, delivery: { ...order.delivery, serviceType: 'rdbs' } },
        'label',
      ),
    ).toThrow();
  });
  it('blocks dispatch of an unconfirmed order and changed quantities or price', () => {
    const ref = { externalOrderId: order.id, items: order.items };
    expect(() => assertCurrentShipment(order, ref, 'pack')).not.toThrow();
    expect(() => assertCurrentShipment(order, ref, 'dispatch')).toThrow(
      'ORDER_NOT_AVAILABLE',
    );
    const ready = { ...order, status: 'ready_to_ship' };
    expect(() => assertCurrentShipment(ready, ref, 'dispatch')).not.toThrow();
    for (const patch of [{ quantity: 2 }, { priceMinor: 1 }])
      expect(() =>
        assertCurrentShipment(
          { ...ready, items: [{ ...order.items[0]!, ...patch }] },
          ref,
          'dispatch',
        ),
      ).toThrow('ORDER_COMPOSITION_CHANGED');
  });
});
