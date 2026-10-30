<script setup lang="ts">
import { useDisplay } from 'vuetify';
import type { StockPage } from '../inventory-api';
import DesignIcon from './DesignIcon.vue';
import ProductThumbnail from './ProductThumbnail.vue';
defineProps<{
  data: StockPage | undefined;
  pending: boolean;
  failed: boolean;
  offset: number;
  appliedSearch: string;
}>();
const search = defineModel<string>({ required: true });
const emit = defineEmits<{
  search: [];
  page: [direction: number];
  units: [variantId: string];
}>();
const { mdAndUp } = useDisplay();
</script>
<template>
  <v-card
    :rounded="mdAndUp ? 'xl' : 0"
    :border="mdAndUp"
    :color="mdAndUp ? 'surface' : 'transparent'"
  >
    <header class="pa-md-5 mb-4 mb-md-0">
      <h2 class="text-title-medium mb-4">Товары на складе</h2>
      <form role="search" class="d-flex ga-3" @submit.prevent="emit('search')">
        <v-text-field
          id="stock-search"
          v-model="search"
          type="search"
          maxlength="120"
          aria-label="Поиск по складу"
          placeholder="GTIN, название, размер или артикул"
          class="min-w-0"
          ><template #prepend-inner
            ><DesignIcon name="search" /></template></v-text-field
        ><v-btn type="submit">Найти</v-btn>
      </form>
    </header>
    <v-progress-linear
      v-if="pending"
      indeterminate
      color="primary"
      aria-label="Загружаем остатки"
    />
    <div v-else-if="!failed && !data?.items.length" class="pa-6 text-center">
      <h3 class="text-title-medium">
        {{ appliedSearch ? 'Товары не найдены' : 'На складе пока пусто' }}
      </h3>
      <p class="text-body-small text-secondary mt-2">
        {{
          appliedSearch
            ? 'Измените запрос поиска.'
            : 'После первого скана здесь появится товар и количество экземпляров.'
        }}
      </p>
    </div>
    <v-table
      v-else-if="mdAndUp && data?.items.length"
      aria-label="Складские остатки"
      ><thead class="bg-raised text-muted">
        <tr>
          <th>Товар</th>
          <th>Вариант / GTIN</th>
          <th>Остаток</th>
          <th>Статус</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in data.items" :key="item.id">
          <td>
            <div class="d-flex align-center ga-3 py-2">
              <ProductThumbnail :color="item.color" />
              <div>
                <p class="text-title-small">
                  {{ item.productName ?? item.name }}
                </p>
                <p class="text-label-small text-muted">
                  {{ item.article ?? 'Модель не указана' }}
                </p>
              </div>
            </div>
          </td>
          <td>
            <p class="text-body-small text-secondary">
              {{
                [item.color, item.size].filter(Boolean).join(' · ') ||
                'Нет размера и цвета'
              }}
            </p>
            <p class="text-label-small text-muted">
              {{ item.gtins.join(', ') }}
            </p>
          </td>
          <td class="text-title-small">{{ item.onHand }} шт.</td>
          <td>
            <v-chip color="success-soft" class="text-success"
              >Доступно: {{ item.available }}</v-chip
            >
          </td>
          <td>
            <v-btn
              icon
              size="32"
              variant="text"
              aria-label="Показать экземпляры"
              @click="emit('units', item.id)"
              ><DesignIcon name="chevron"
            /></v-btn>
          </td>
        </tr></tbody
    ></v-table>
    <template v-else
      ><v-card
        v-for="item in data?.items"
        :key="item.id"
        border
        rounded="lg"
        class="pa-3 mb-3"
        ><div class="d-flex align-center ga-3">
          <ProductThumbnail :color="item.color" />
          <div class="flex-grow-1 min-w-0">
            <h3 class="text-title-small">
              {{ item.productName ?? item.name }}
            </h3>
            <p class="text-body-small text-secondary">
              {{
                [item.color, item.size].filter(Boolean).join(' · ') ||
                'Размер и цвет пока не указаны'
              }}
            </p>
            <strong class="text-title-small">{{ item.onHand }} шт.</strong>
          </div>
          <v-btn
            icon
            size="32"
            variant="text"
            aria-label="Показать экземпляры"
            @click="emit('units', item.id)"
            ><DesignIcon name="chevron"
          /></v-btn>
        </div>
        <p class="text-label-small text-muted mt-2">
          GTIN {{ item.gtins.join(', ') }}
        </p>
        <div class="d-flex ga-3 flex-wrap text-label-small mt-2">
          <span class="text-success">Доступно {{ item.available }}</span
          ><span v-if="item.reserved" class="text-secondary"
            >Резерв {{ item.reserved }}</span
          ><span v-if="item.defective" class="text-error"
            >Брак {{ item.defective }}</span
          >
        </div>
      </v-card></template
    >
    <nav
      class="d-flex justify-space-between ga-3 pa-md-5 mt-4"
      aria-label="Страницы товаров"
    >
      <v-btn v-if="offset" @click="emit('page', -1)">Назад</v-btn
      ><v-spacer /><v-btn v-if="data?.hasMore" @click="emit('page', 1)"
        >Следующие товары</v-btn
      >
    </nav>
  </v-card>
</template>
