<script setup lang="ts">
import { computed } from 'vue';
import type { ScanResult } from '../inventory-api';
const props = defineProps<{ result: ScanResult }>();
const details = computed(() =>
  [
    props.result.unit.article ? `Арт. ${props.result.unit.article}` : '',
    props.result.unit.color,
    props.result.unit.size ? `Размер ${props.result.unit.size}` : '',
  ]
    .filter(Boolean)
    .join(' · '),
);
const warning = computed(() => {
  const status = props.result.unit.catalogStatus;
  if (status === 'CONFLICT')
    return 'В карточке ЧЗ есть противоречия. Характеристики требуют проверки.';
  if (status === 'PARTIAL')
    return 'В карточке ЧЗ не все характеристики. Проверьте артикул, цвет и размер.';
  if (status === 'RESOLVED' || status === 'MANUAL') return '';
  switch (props.result.catalogLookup) {
    case 'UNAVAILABLE':
      return 'Товар сохранён. Каталог ЧЗ недоступен — характеристики пока не получены.';
    case 'NOT_CONFIGURED':
      return 'Товар сохранён. На сервере не настроен ключ Национального каталога.';
    case 'AMBIGUOUS':
      return 'Товар сохранён. Для GTIN найдено несколько карточек — требуется проверка.';
    default:
      return 'Товар сохранён. Характеристики по GTIN пока не найдены.';
  }
});
</script>
<template>
  <p v-if="details" class="text-label-small text-secondary mt-1">
    {{ details }}
  </p>
  <p
    v-if="warning"
    class="text-label-small text-warning mt-1"
    data-testid="catalog-warning"
  >
    {{ warning }}
  </p>
</template>
