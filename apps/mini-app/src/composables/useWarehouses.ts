import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { warehouseListSchema } from '@avito/contracts';
import { createWarehouseApi } from '../warehouse-api';

// Session-local UI choice; warehouse records remain owned by TanStack Query.
const selectedId = ref<string>();
export function useWarehouses(initData: string) {
  const api = createWarehouseApi(initData);
  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: ({ signal }) =>
      api('warehouses', warehouseListSchema, undefined, signal),
    retry: false,
  });
  const selected = computed(
    () =>
      warehouses.data.value?.items.find((w) => w.id === selectedId.value) ??
      warehouses.data.value?.items.find((w) => w.isDefault),
  );
  const warehouseId = computed(() => selected.value?.id);
  return {
    warehouses,
    selected,
    warehouseId,
    select: (id: string) => {
      selectedId.value = id;
    },
  };
}
