<script setup lang="ts">
import { computed } from 'vue';
import type { StockFilter } from '@avito/contracts';
import type { StockPage } from '../inventory-api';
import { groupStock, stockVariantLabel } from '../stock-display';
import DesignIcon from './DesignIcon.vue';

const props = defineProps<{
  data: StockPage | undefined;
  pending: boolean;
  failed: boolean;
  offset: number;
  appliedSearch: string;
}>();
const search = defineModel<string>({ required: true });
const filter = defineModel<StockFilter>('filter', { required: true });
const emit = defineEmits<{
  search: [];
  page: [direction: number];
  units: [variantId: string];
  retry: [];
}>();
const groups = computed(() => groupStock(props.data?.items ?? []));
const filters = computed(() => [
  { key: 'all' as const, label: 'Все', count: props.data?.totals.onHand },
  {
    key: 'available' as const,
    label: 'Свободно',
    count: props.data?.totals.available,
  },
  {
    key: 'reserved' as const,
    label: 'В резерве',
    count: props.data?.totals.reserved,
  },
]);
</script>

<template>
  <section aria-labelledby="stock-title">
    <h2 id="stock-title" class="text-title-medium mb-4">Товары на складе</h2>
    <form
      role="search"
      class="d-flex ga-2 mb-3"
      @submit.prevent="emit('search')"
    >
      <v-text-field
        id="stock-search"
        v-model="search"
        type="search"
        maxlength="120"
        aria-label="Поиск по складу"
        placeholder="Модель, размер, GTIN"
        class="min-w-0"
        hide-details
        ><template #prepend-inner><DesignIcon name="search" /></template
      ></v-text-field>
      <v-btn type="submit" color="primary" variant="outlined">Найти</v-btn>
    </form>
    <div class="d-flex flex-wrap ga-2 mb-4" role="group" aria-label="Наличие">
      <v-btn
        v-for="option in filters"
        :key="option.key"
        color="primary"
        :variant="filter === option.key ? 'tonal' : 'outlined'"
        :aria-pressed="filter === option.key"
        density="comfortable"
        class="px-3"
        @click="filter = option.key"
        >{{ option.label
        }}{{ option.count === undefined ? '' : ' ' + option.count }}</v-btn
      >
    </div>
    <v-progress-linear
      v-if="pending"
      indeterminate
      color="primary"
      aria-label="Загружаем остатки"
    />
    <v-alert v-else-if="failed" type="error">
      Не удалось загрузить остатки.
      <v-btn
        color="primary"
        variant="outlined"
        class="mt-2"
        @click="emit('retry')"
        >Повторить</v-btn
      >
    </v-alert>
    <p
      v-else-if="!groups.length"
      class="text-body-medium text-secondary py-5"
      role="status"
    >
      {{
        appliedSearch
          ? 'По запросу ничего не найдено.'
          : filter === 'reserved'
            ? 'На этом складе нет пар в резерве.'
            : filter === 'available'
              ? 'На этом складе нет свободных пар.'
              : 'На складе пока пусто.'
      }}
    </p>
    <v-card
      v-for="group in groups"
      :key="group.id"
      border
      rounded="lg"
      class="mb-3"
    >
      <header class="px-4 py-3 text-on-surface">
        <h3 class="text-title-small stock-wrap">{{ group.name }}</h3>
        <p v-if="group.article" class="text-body-small text-secondary mt-1">
          Арт. {{ group.article }}
        </p>
      </header>
      <template v-for="item in group.items" :key="item.id">
        <v-divider />
        <button
          type="button"
          class="stock-variant px-4 py-3"
          :aria-label="`Показать экземпляры: ${group.name}, ${stockVariantLabel(item)}, свободно ${item.available}, к сборке ${item.readyToCollect}, в резерве ${item.reserved}${item.withdrawn ? `, выведено из оборота ${item.withdrawn}` : ''}`"
          @click="emit('units', item.id)"
        >
          <span class="min-w-0 stock-wrap">
            <span class="d-block text-label-large">{{
              stockVariantLabel(item)
            }}</span>
            <span
              v-if="item.gtins.length"
              class="d-block text-body-small text-secondary mt-1"
              >{{ item.gtins.join(', ') }}</span
            >
          </span>
          <span class="stock-counts text-body-small">
            <span class="text-secondary">Свободно {{ item.available }}</span>
            <span
              :class="item.readyToCollect ? 'text-success' : 'text-secondary'"
            >
              К сборке {{ item.readyToCollect }}
            </span>
            <span :class="item.reserved ? 'text-warning' : 'text-secondary'"
              >В резерве {{ item.reserved }}</span
            >
            <span class="text-secondary"
              >Всего <span>{{ item.onHand }} шт.</span></span
            >
            <span v-if="item.withdrawn" class="text-warning">
              Выведено из оборота: {{ item.withdrawn }}
            </span>
            <span v-if="item.defective" class="text-error"
              >Брак {{ item.defective }}</span
            >
          </span>
          <DesignIcon name="chevron" class="stock-chevron" />
        </button>
      </template>
    </v-card>
    <nav
      v-if="offset || data?.hasMore"
      class="d-flex justify-space-between ga-2 mt-4"
      aria-label="Страницы товаров"
    >
      <v-btn
        v-if="offset"
        color="primary"
        variant="outlined"
        @click="emit('page', -1)"
        >Назад</v-btn
      >
      <v-spacer />
      <v-btn
        v-if="data?.hasMore"
        color="primary"
        variant="outlined"
        @click="emit('page', 1)"
        >Следующие товары</v-btn
      >
    </nav>
  </section>
</template>

<style scoped>
.stock-variant {
  appearance: none;
  border: 0;
  background: transparent;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 20px;
  gap: 12px;
  align-items: center;
  width: 100%;
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
}
.stock-variant:hover {
  background: rgb(var(--v-theme-raised));
}
.stock-variant:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.stock-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}
.stock-wrap {
  overflow-wrap: anywhere;
}
@media (max-width: 599px) {
  .stock-variant {
    grid-template-columns: minmax(0, 1fr) 20px;
    gap: 6px;
  }
  .stock-counts {
    grid-row: 2;
  }
  .stock-chevron {
    grid-column: 2;
    grid-row: 1 / 3;
  }
}
</style>
