<script setup lang="ts">
import { computed, ref, defineAsyncComponent, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { InventoryUnitsResponse, StockFilter } from '@avito/contracts';
import { createInventoryApi } from '../inventory-api';
import { useWarehouses } from '../composables/useWarehouses';
import { layout } from '../design/tokens';
const UnitLegalStatus = defineAsyncComponent(
  () => import('./marking/UnitLegalStatus.vue'),
);
const props = defineProps<{
  variantId: string;
  initData: string;
  roles?: string[];
  initialFilter: StockFilter;
}>();
const offset = ref(0);
const filter = ref(props.initialFilter);
watch(filter, () => {
  offset.value = 0;
});
const filters = [
  { key: 'all', label: 'Все' },
  { key: 'available', label: 'Доступные' },
  { key: 'reserved', label: 'В резерве' },
] as const;
const { warehouseId } = useWarehouses(props.initData);
const api = createInventoryApi(props.initData);
const units = useQuery({
  queryKey: computed(() => [
    'inventory-units',
    warehouseId.value,
    props.variantId,
    offset.value,
    filter.value,
  ]),
  queryFn: ({ signal }) =>
    api<InventoryUnitsResponse>(
      `/variants/${props.variantId}/units?offset=${offset.value}&stock=${filter.value}${warehouseId.value ? '&warehouseId=' + warehouseId.value : ''}`,
      undefined,
      signal,
    ),
  retry: false,
});
const states: Record<string, string> = {
  QUARANTINE: 'Карантин',
  AVAILABLE: 'Доступен',
  RESERVED: 'В резерве',
  PACKING: 'Упаковка',
  IN_TRANSIT: 'В пути',
  RETURN_IN_TRANSIT: 'Возвращается',
  DEFECTIVE: 'Брак',
  LOST: 'Утерян',
  WITH_CUSTOMER: 'У покупателя',
};
const date = (value: string) =>
  new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
</script>
<template>
  <div>
    <div
      class="d-flex flex-wrap ga-2 mb-4"
      role="group"
      aria-label="Наличие экземпляров"
    >
      <v-btn
        v-for="option in filters"
        :key="option.key"
        color="primary"
        :variant="filter === option.key ? 'tonal' : 'outlined'"
        density="comfortable"
        :aria-pressed="filter === option.key"
        @click="filter = option.key"
        >{{ option.label }}</v-btn
      >
    </div>
    <v-progress-linear
      v-if="units.isPending.value"
      indeterminate
      color="primary"
      aria-label="Загружаем экземпляры"
    />
    <v-alert v-else-if="units.isError.value" type="error" role="alert"
      >{{ units.error.value?.message
      }}<v-btn class="mt-3" @click="units.refetch()">Повторить</v-btn></v-alert
    >
    <template v-else>
      <p
        v-if="!units.data.value?.items.length"
        class="text-body-medium text-secondary py-4"
      >
        Нет экземпляров с выбранным фильтром.
      </p>
      <v-sheet
        v-for="unit in units.data.value?.items"
        :key="unit.id"
        color="raised"
        rounded="lg"
        class="pa-4 mb-3"
      >
        <div class="d-flex justify-space-between align-start ga-3 flex-wrap">
          <strong class="text-title-small">{{ unit.maskedCode }}</strong
          ><v-chip
            :color="
              (
                unit.stockStatus
                  ? unit.stockStatus === 'available'
                  : unit.state === 'AVAILABLE'
              )
                ? 'success-soft'
                : 'warning-soft'
            "
            :class="
              (
                unit.stockStatus
                  ? unit.stockStatus === 'available'
                  : unit.state === 'AVAILABLE'
              )
                ? 'text-success'
                : 'text-warning'
            "
            >{{
              unit.stockStatus === 'reserved'
                ? unit.state === 'PACKING'
                  ? 'В резерве · упаковка'
                  : 'В резерве'
                : unit.stockStatus === 'other' && unit.state === 'AVAILABLE'
                  ? 'Недоступен'
                  : (states[unit.state] ?? 'Требует уточнения')
            }}</v-chip
          >
        </div>
        <p class="text-body-small text-secondary mt-2">
          {{ unit.location ?? 'Место не указано' }}
        </p>
        <p class="text-body-small text-secondary">
          {{ date(unit.receivedAt) }} · {{ unit.receiptNumber }}
        </p>
        <p class="text-label-small text-muted mt-1">{{ unit.internalCode }}</p>
        <UnitLegalStatus
          :unit-id="unit.id"
          :init-data="initData"
          :roles="roles ?? []"
        />
      </v-sheet>
      <nav
        class="d-flex justify-space-between ga-3"
        aria-label="Страницы экземпляров"
      >
        <v-btn
          v-if="offset"
          color="primary"
          variant="outlined"
          @click="offset -= layout.unitsPageSize"
          >Назад</v-btn
        ><v-btn
          v-if="units.data.value?.hasMore"
          color="primary"
          variant="outlined"
          @click="offset += layout.unitsPageSize"
          >Следующие экземпляры</v-btn
        >
      </nav>
    </template>
  </div>
</template>
