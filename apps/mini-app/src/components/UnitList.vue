<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { InventoryUnitsResponse } from '@avito/contracts';
import { createInventoryApi } from '../inventory-api';
import { layout } from '../design/tokens';
const props = defineProps<{ variantId: string; initData: string }>();
const offset = ref(0);
const api = createInventoryApi(props.initData);
const units = useQuery({
  queryKey: computed(() => ['inventory-units', props.variantId, offset.value]),
  queryFn: ({ signal }) =>
    api<InventoryUnitsResponse>(
      `/variants/${props.variantId}/units?offset=${offset.value}`,
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
        Экземпляров в этой ячейке больше нет.
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
              unit.state === 'AVAILABLE' ? 'success-soft' : 'warning-soft'
            "
            :class="
              unit.state === 'AVAILABLE' ? 'text-success' : 'text-warning'
            "
            >{{ states[unit.state] ?? 'Требует уточнения' }}</v-chip
          >
        </div>
        <p class="text-body-small text-secondary mt-2">
          {{ unit.location ?? 'Место не указано' }}
        </p>
        <p class="text-body-small text-secondary">
          {{ date(unit.receivedAt) }} · {{ unit.receiptNumber }}
        </p>
        <p class="text-label-small text-muted mt-1">{{ unit.internalCode }}</p>
      </v-sheet>
      <nav
        class="d-flex justify-space-between ga-3"
        aria-label="Страницы экземпляров"
      >
        <v-btn v-if="offset" @click="offset -= layout.unitsPageSize"
          >Назад</v-btn
        ><v-btn
          v-if="units.data.value?.hasMore"
          @click="offset += layout.unitsPageSize"
          >Следующие экземпляры</v-btn
        >
      </nav>
    </template>
  </div>
</template>
