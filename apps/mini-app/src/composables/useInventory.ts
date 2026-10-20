import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { createInventoryApi, type StockPage } from '../inventory-api';
import { layout } from '../design/tokens';

export function useInventory(initData: string) {
  const api = createInventoryApi(initData);
  const search = ref('');
  const appliedSearch = ref('');
  const offset = ref(0);
  const expanded = ref<string | null>(null);
  const stock = useQuery({
    queryKey: computed(() => ['inventory', appliedSearch.value, offset.value]),
    queryFn: ({ signal }) =>
      api<StockPage>(
        `?search=${encodeURIComponent(appliedSearch.value)}&offset=${offset.value}&limit=${layout.pageSize}`,
        undefined,
        signal,
      ),
    retry: false,
    refetchInterval: layout.pollingInterval,
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
    expanded,
    searchStock,
    changePage,
  };
}
