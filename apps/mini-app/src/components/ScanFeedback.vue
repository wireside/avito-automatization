<script setup lang="ts">
import { computed } from 'vue';
import type { ScanResult } from '../inventory-api';
import DesignIcon from './DesignIcon.vue';
import ReceiptCatalogDetails from './ReceiptCatalogDetails.vue';
const props = defineProps<{
  result: ScanResult | undefined;
  processing: boolean;
  queueLength: number;
}>();
const duplicate = computed(() => props.result?.outcome === 'DUPLICATE');
</script>
<template>
  <v-sheet
    v-if="processing && !result"
    color="raised"
    rounded="md"
    class="pa-4 d-flex align-center ga-3"
    role="status"
    aria-live="polite"
  >
    <v-progress-circular indeterminate color="primary" size="20" width="2" />
    <div>
      <p class="text-title-small">Распознаём и добавляем товар…</p>
      <p class="text-body-small text-secondary">
        В очереди: {{ queueLength }}. Дождитесь подтверждения.
      </p>
    </div>
  </v-sheet>
  <v-sheet
    v-else-if="result"
    :color="duplicate ? 'warning-soft' : 'success-soft'"
    rounded="md"
    class="pa-3 scan-feedback"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    data-testid="scan-result"
  >
    <div
      class="d-flex align-center ga-2 mb-1"
      :class="duplicate ? 'text-warning' : 'text-success'"
    >
      <DesignIcon v-if="!duplicate" name="check" />
      <v-icon v-else icon="$info" size="18" />
      <strong class="text-title-small flex-grow-1">{{
        duplicate ? 'Этот товар уже добавлен' : 'Товар добавлен на склад'
      }}</strong>
      <strong v-if="!duplicate" class="text-label-large">+1</strong>
    </div>
    <p class="text-body-small">{{ result.unit.name }}</p>
    <ReceiptCatalogDetails :result="result" />
    <p class="text-label-small text-secondary mt-1">
      {{
        duplicate
          ? 'Повторный скан · остаток не изменён'
          : `${result.unit.location ?? 'Зона приёмки'} · ожидает проверки`
      }}
    </p>
    <p class="text-label-small text-secondary">{{ result.unit.maskedCode }}</p>
    <p v-if="processing" class="text-label-small text-secondary mt-2">
      Добавляем следующий товар… В очереди: {{ queueLength }}
    </p>
  </v-sheet>
  <v-sheet v-else color="surface" rounded="md" class="pa-3" role="status">
    <p class="text-title-small d-flex align-center ga-2">
      <span class="status-dot bg-success" />Готов к сканированию
    </p>
    <p class="text-body-small text-secondary mt-1">
      После скана товар появится здесь.
    </p>
    <p class="text-label-small text-muted mt-1">
      Камера — кнопка справа от поля.
    </p>
  </v-sheet>
</template>
