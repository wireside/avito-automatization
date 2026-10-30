import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { createOrdersApi } from '../orders-api';
export function useOrders(initData: string) {
  const api = createOrdersApi(initData);
  const status = ref('');
  const page = ref(1);
  const selectedId = ref<string | null>(null);
  const search = ref('');
  watch(status, () => {
    page.value = 1;
  });
  const orders = useQuery({
    queryKey: computed(() => ['avito-orders', status.value, page.value]),
    queryFn: ({ signal }) =>
      api.list({ page: page.value, status: status.value }, signal),
    enabled: computed(() => !selectedId.value),
    retry: false,
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const detail = useQuery({
    queryKey: computed(() => ['avito-order', selectedId.value]),
    queryFn: ({ signal }) => api.detail(selectedId.value!, signal),
    enabled: computed(() => !!selectedId.value),
    retry: false,
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const visibleOrders = computed(() => {
    const term = (search.value ?? '').toLocaleLowerCase('ru-RU').trim();
    return (orders.data.value?.orders ?? []).filter(
      (o) =>
        !term ||
        o.id.includes(term) ||
        o.marketplaceId?.includes(term) ||
        o.items.some(
          (i) =>
            i.title.toLocaleLowerCase('ru-RU').includes(term) ||
            i.avitoId.includes(term),
        ),
    );
  });
  return { status, page, selectedId, search, orders, detail, visibleOrders };
}
