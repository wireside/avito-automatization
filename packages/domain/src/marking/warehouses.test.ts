import { it, expect, vi } from 'vitest';
import {
  createWarehouseSettings,
  type WarehouseSettingsStore,
} from './warehouses.js';
const owner = {
  id: 'owner',
  telegramId: '1',
  displayName: null,
  roles: ['OWNER'],
};
function setup() {
  const store = {
    list: vi.fn().mockResolvedValue([]),
    connection: vi.fn().mockResolvedValue({
      sellerInn: '123456789012',
      signerActive: true,
      authorized: true,
    }),
    connect: vi.fn(),
    replay: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({ warehouseId: 'local' }),
  } satisfies WarehouseSettingsStore;
  const places = vi.fn().mockResolvedValue({
    items: [{ fiasId: 'fias', address: 'Адрес из ЧЗ' }],
    incompleteCount: 0,
  });
  return { store, places, service: createWarehouseSettings({ store, places }) };
}
it('keeps warehouse reading available to staff and protects connection and address changes', async () => {
  const { service, places, store } = setup();
  const viewer = { ...owner, roles: ['WAREHOUSE'] };
  expect(await service.list(viewer)).toEqual({ ok: true, items: [] });
  await expect(service.places(viewer)).rejects.toThrow('FORBIDDEN');
  await expect(service.connect(viewer, '123456789012')).rejects.toThrow(
    'FORBIDDEN',
  );
  expect(places).not.toHaveBeenCalled();
  expect(store.connect).not.toHaveBeenCalled();
});
it('resolves the submitted address from fresh CHZ data and rejects an unlisted identifier', async () => {
  const { service, store } = setup();
  const input = { requestId: 'request', name: 'Склад', fiasId: 'fias' };
  await service.save(owner, input);
  expect(store.save).toHaveBeenCalledWith(
    input,
    { fiasId: 'fias', address: 'Адрес из ЧЗ' },
    '123456789012',
    owner.id,
  );
  await expect(
    service.save(owner, { ...input, fiasId: 'foreign' }),
  ).rejects.toThrow('CHZ_PLACE_NOT_FOUND');
  expect(store.save).toHaveBeenCalledOnce();
});
it('replays a committed save without requiring the provider to be available again', async () => {
  const { service, store, places } = setup();
  store.replay.mockResolvedValue({ warehouseId: 'existing' });
  expect(
    await service.save(owner, {
      requestId: 'r',
      name: 'Склад',
      fiasId: 'fias',
    }),
  ).toEqual({ ok: true, warehouseId: 'existing' });
  expect(places).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});
