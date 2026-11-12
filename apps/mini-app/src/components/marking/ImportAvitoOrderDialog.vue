<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/vue-query';
import {
  inventoryPageResponseSchema,
  type InventoryPageResponse,
} from '@avito/contracts';
import { useWarehouses } from '../../composables/useWarehouses';
import type { MarketplaceOrderDto } from '../../orders-api';
import {
  createMarkingApi,
  markingLabel,
  MarkingApiError,
} from '../../marking-api';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ initData: string; order: MarketplaceOrderDto }>();
const emit = defineEmits<{ done: [] }>();
const { warehouses, warehouseId, selected, select } = useWarehouses(
  props.initData,
);
const client = useQueryClient(),
  busy = ref(false),
  error = ref(''),
  selection = ref<Record<string, string>>({}),
  requestId = ref(crypto.randomUUID());
const stock = useInfiniteQuery<
  InventoryPageResponse,
  Error,
  InfiniteData<InventoryPageResponse>,
  readonly (string | undefined)[],
  number
>({
  queryKey: computed(() => ['inventory', 'mapping-options', warehouseId.value]),
  enabled: computed(() => open.value),
  initialPageParam: 0,
  getNextPageParam: (last, pages) =>
    last.hasMore ? pages.length * 100 : undefined,
  queryFn: async ({ pageParam, signal }) => {
    const r = await fetch(
      `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/inventory?limit=100&offset=${pageParam}${warehouseId.value ? '&warehouseId=' + warehouseId.value : ''}`,
      {
        headers: { authorization: `tma ${props.initData}` },
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      },
    );
    if (!r.ok) throw new Error('INVENTORY_UNAVAILABLE');
    return inventoryPageResponseSchema.parse(await r.json());
  },
});
const choices = computed(
  () =>
    stock.data.value?.pages
      .flatMap((p) => p.items)
      .map((v) => ({
        title: [v.name, v.size, v.color].filter(Boolean).join(' · '),
        value: v.id,
      })) ?? [],
);
watch(open, (v) => {
  if (v) {
    error.value = '';
    selection.value = {};
    requestId.value = crypto.randomUUID();
  }
});
watch(warehouseId, () => {
  selection.value = {};
  requestId.value = crypto.randomUUID();
});
watch(
  selection,
  () => {
    requestId.value = crypto.randomUUID();
  },
  { deep: true },
);
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await createMarkingApi(props.initData).command('importOrder', {
      requestId: requestId.value,
      externalOrderId: props.order.id,
      ...(warehouseId.value ? { warehouseId: warehouseId.value } : {}),
      mappings: Object.entries(selection.value)
        .filter(([, v]) => !!v)
        .map(([externalItemId, variantId]) => ({ externalItemId, variantId })),
    });
    await client.invalidateQueries({ queryKey: ['marking'] });
    emit('done');
    open.value = false;
  } catch (e) {
    error.value =
      e instanceof MarkingApiError
        ? markingLabel(e.code)
        : 'Не удалось начать сборку';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <v-dialog v-model="open" max-width="620" :persistent="busy"
    ><v-card class="pa-5"
      ><h2 class="text-title-medium">Собрать заказ</h2>
      <p class="text-body-small text-secondary mt-3">
        Резервируем вещи на складе и создаём задание на упаковку. Это не
        подтверждение заказа в Авито. Состав будет проверен в Авито. Если
        объявление уже сопоставлено со складом, выбирать вариант повторно не
        нужно.
      </p>
      <v-select
        class="mt-4"
        :model-value="warehouseId"
        :items="warehouses.data.value?.items ?? []"
        item-title="name"
        item-value="id"
        label="Склад отгрузки"
        :disabled="busy"
        @update:model-value="$event && select($event)"
      />
      <p
        v-if="selected && !selected.configured"
        class="text-body-small text-warning"
      >
        Сначала настройте адрес отгрузки этого склада в настройках.
      </p>
      <v-alert v-if="error" type="warning" class="my-4">{{ error }}</v-alert>
      <div v-for="item in order.items" :key="item.avitoId" class="mt-4">
        <p class="text-title-small">
          {{ item.title }} · {{ item.quantity }} шт.
        </p>
        <v-autocomplete
          :model-value="selection[item.avitoId] ?? null"
          :items="choices"
          :loading="stock.isFetching.value"
          clearable
          label="Вариант на складе — только при первом сопоставлении"
          no-data-text="Нет загруженных вариантов. Сначала примите товар на склад."
          @update:model-value="selection[item.avitoId] = $event ?? ''"
        />
      </div>
      <v-btn
        v-if="stock.hasNextPage.value"
        variant="text"
        :loading="stock.isFetchingNextPage.value"
        @click="stock.fetchNextPage()"
        >Показать ещё варианты склада</v-btn
      >
      <v-alert v-if="stock.isError.value" type="error" class="my-3"
        >Не удалось загрузить варианты склада.
        <v-btn variant="text" @click="stock.refetch()"
          >Повторить</v-btn
        ></v-alert
      ><v-btn
        :loading="busy"
        :disabled="selected ? !selected.configured : false"
        color="primary-strong"
        class="mt-4"
        @click="submit"
        >Начать сборку</v-btn
      ><v-btn variant="text" class="mt-2" :disabled="busy" @click="open = false"
        >Закрыть</v-btn
      ></v-card
    ></v-dialog
  >
</template>
