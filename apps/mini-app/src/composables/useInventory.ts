import { computed, ref, watch } from 'vue';
import type { StockFilter } from '@avito/contracts';
import { useQuery } from '@tanstack/vue-query';
import { createInventoryApi, type StockPage } from '../inventory-api';
import { useWarehouses } from './useWarehouses';
import { layout } from '../design/tokens';

export function useInventory(initData: string) {
  const api = createInventoryApi(initData);
  const { warehouseId } = useWarehouses(initData);
  const search = ref('');
  const appliedSearch = ref('');
  const offset = ref(0);
  const filter = ref<StockFilter>('all');
  const expanded = ref<string | null>(null);
  const stock = useQuery({
    queryKey: computed(() => [
      'inventory',
      warehouseId.value,
      appliedSearch.value,
      filter.value,
      offset.value,
    ]),
    queryFn: ({ signal }) =>
      api<StockPage>(
        `?search=${encodeURIComponent(appliedSearch.value)}&stock=${filter.value}&offset=${offset.value}&limit=${layout.pageSize}${warehouseId.value ? '&warehouseId=' + warehouseId.value : ''}`,
        undefined,
        signal,
      ),
    retry: false,
    refetchInterval: layout.pollingInterval,
  });
  watch([warehouseId, filter], () => {
    offset.value = 0;
    expanded.value = null;
  });
  function searchStock() {
    offset.value = 0;
    appliedSearch.value = search.value;
    expanded.value = null;
  }
  function changePage(direction: number) {
    offset.value = Math.max(0, offset.value + direction * layout.pageSize);
    expanded.value = null;
  }
  return {
    stock,
    search,
    appliedSearch,
    offset,
    filter,
    expanded,
    searchStock,
    changePage,
  };
}
