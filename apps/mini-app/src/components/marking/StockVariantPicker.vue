<script setup lang="ts">
import { computed, ref } from 'vue';
import { useInfiniteQuery } from '@tanstack/vue-query';
import { inventoryPageResponseSchema } from '@avito/contracts';
import { createInventoryApi, type StockVariant } from '../../inventory-api';
import { groupStock, stockVariantLabel } from '../../stock-display';
import DesignIcon from '../DesignIcon.vue';

const props = defineProps<{
  initData: string;
  warehouseId: string | undefined;
  title: string;
  quantity: number;
  selectedId?: string | undefined;
}>();
const emit = defineEmits<{ close: []; select: [variant: StockVariant] }>();
const search = ref('');
const appliedSearch = ref('');
const pageSize = 40;
const api = createInventoryApi(props.initData);
const stock = useInfiniteQuery({
  queryKey: computed(() => [
    'inventory',
    'collection-picker',
    props.warehouseId,
    appliedSearch.value,
  ]),
  queryFn: async ({ pageParam, signal }) => {
    const params = new URLSearchParams({
      search: appliedSearch.value,
      offset: String(pageParam),
      limit: String(pageSize),
      stock: 'available',
    });
    if (props.warehouseId) params.set('warehouseId', props.warehouseId);
    return inventoryPageResponseSchema.parse(
      await api<unknown>(`?${params}`, undefined, signal),
    );
  },
  initialPageParam: 0,
  getNextPageParam: (last, pages) =>
    last.hasMore ? pages.length * pageSize : undefined,
  staleTime: 0,
  retry: false,
});
const groups = computed(() =>
  groupStock(stock.data.value?.pages.flatMap((p) => p.items) ?? []),
);
</script>

<template>
  <h2 id="collect-stock-title" class="text-title-medium">Выбрать позицию</h2>
  <p class="text-body-small text-secondary mt-2 picker-wrap">
    {{ title }} · нужно {{ quantity }} шт.
  </p>
  <form
    role="search"
    class="d-flex ga-2 mt-4"
    @submit.prevent="appliedSearch = search.trim()"
  >
    <v-text-field
      v-model="search"
      type="search"
      aria-label="Поиск позиции на складе"
      placeholder="Модель, размер, GTIN"
      maxlength="120"
      hide-details
      class="min-w-0"
      ><template #prepend-inner><DesignIcon name="search" /></template
    ></v-text-field>
    <v-btn type="submit" color="primary" variant="outlined">Найти</v-btn>
  </form>
  <div class="mt-4" aria-live="polite">
    <v-progress-linear
      v-if="stock.isPending.value"
      indeterminate
      color="primary"
      aria-label="Загружаем позиции"
    />
    <v-alert v-else-if="stock.isError.value && !groups.length" type="error">
      Не удалось загрузить позиции.
      <v-btn
        color="primary"
        variant="outlined"
        class="mt-2"
        @click="stock.refetch()"
        >Повторить</v-btn
      >
    </v-alert>
    <p v-else-if="!groups.length" class="text-body-medium text-secondary py-3">
      {{
        appliedSearch
          ? 'По запросу нет доступных позиций.'
          : 'На выбранном складе нет доступных позиций.'
      }}
    </p>
    <v-card
      v-for="group in groups"
      :key="group.id"
      border
      rounded="lg"
      class="mb-3"
    >
      <header class="px-3 py-2 text-on-surface picker-wrap">
        <h3 class="text-title-small">{{ group.name }}</h3>
        <p v-if="group.article" class="text-body-small text-secondary">
          Арт. {{ group.article }}
        </p>
      </header>
      <template v-for="item in group.items" :key="item.id">
        <v-divider />
        <button
          type="button"
          class="picker-row d-flex justify-space-between align-center ga-3 px-3 py-2"
          :aria-pressed="selectedId === item.id"
          :disabled="item.available < quantity"
          @click="emit('select', item)"
        >
          <span class="min-w-0 picker-wrap">
            <span class="d-block text-label-large">{{
              stockVariantLabel(item)
            }}</span>
            <span
              v-if="item.gtins.length"
              class="d-block text-body-small text-secondary"
              >{{ item.gtins.join(', ') }}</span
            >
          </span>
          <span
            class="text-body-small flex-shrink-0 text-right"
            :class="
              item.available < quantity ? 'text-secondary' : 'text-success'
            "
          >
            Доступно {{ item.available }}
            <span v-if="item.available < quantity" class="d-block"
              >Недостаточно</span
            >
          </span>
        </button>
      </template>
    </v-card>
    <p
      v-if="stock.isFetchNextPageError.value"
      class="text-body-small text-error mb-2"
    >
      Не удалось загрузить следующую страницу.
    </p>
    <v-btn
      v-if="stock.hasNextPage.value"
      color="primary"
      variant="outlined"
      :loading="stock.isFetchingNextPage.value"
      block
      @click="stock.fetchNextPage()"
      >{{
        stock.isFetchNextPageError.value ? 'Повторить' : 'Показать ещё'
      }}</v-btn
    >
  </div>
  <v-btn
    color="primary"
    variant="outlined"
    block
    class="mt-4"
    @click="emit('close')"
    >Назад к сборке</v-btn
  >
</template>

<style scoped>
.picker-wrap {
  overflow-wrap: anywhere;
}
.picker-row {
  appearance: none;
  border: 0;
  background: transparent;
  min-height: 48px;
  width: 100%;
  text-align: left;
  color: rgb(var(--v-theme-on-surface));
}
.picker-row:enabled:hover,
.picker-row[aria-pressed='true'] {
  background: rgb(var(--v-theme-raised));
}
.picker-row:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.picker-row:disabled {
  cursor: default;
}
</style>
