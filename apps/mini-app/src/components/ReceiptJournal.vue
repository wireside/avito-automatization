<script setup lang="ts">
import { useDisplay } from 'vuetify';
import type { ReceiptEntry } from '../composables/useIntake';
import type { ScanResult } from '../inventory-api';
import DesignIcon from './DesignIcon.vue';
import ProductThumbnail from './ProductThumbnail.vue';
import ReceiptCatalogDetails from './ReceiptCatalogDetails.vue';
defineProps<{
  entries: ReceiptEntry[];
  acceptedCount: number;
  lastResult: ScanResult | undefined;
  emptyWarehouse: boolean;
}>();
const emit = defineEmits<{ stock: []; units: [variantId: string] }>();
const { mdAndUp } = useDisplay();
const time = (value: string) =>
  new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
</script>
<template>
  <v-card
    :border="mdAndUp"
    :color="mdAndUp ? 'surface' : 'transparent'"
    :rounded="mdAndUp ? 'xl' : 0"
  >
    <header
      class="d-flex align-center ga-3 mb-3 mb-md-0"
      :class="mdAndUp ? 'pa-5' : ''"
    >
      <div class="flex-grow-1 min-w-0">
        <h2 class="text-title-small text-md-title-medium">
          Последние сканирования
        </h2>
        <p class="text-label-small text-muted">
          За эту сессию принято: {{ acceptedCount }}
        </p>
      </div>
      <v-chip color="raised" class="text-secondary">{{
        entries.length
      }}</v-chip>
    </header>
    <div v-if="!entries.length" class="pa-6 text-center">
      <DesignIcon name="scan" />
      <h3 class="text-title-medium mt-4">
        {{ emptyWarehouse ? 'На складе пока пусто' : 'Начните новую приёмку' }}
      </h3>
      <p class="text-body-small text-secondary mt-2">
        Сканируйте первую вещь. После сохранения она появится здесь.
      </p>
      <v-btn variant="text" color="primary" class="mt-3" @click="emit('stock')"
        >Посмотреть остатки</v-btn
      >
    </div>
    <v-table v-else-if="mdAndUp" aria-label="Результаты текущей приёмки">
      <thead class="bg-raised text-muted">
        <tr>
          <th>Товар</th>
          <th>Код экземпляра</th>
          <th>Результат</th>
          <th>Принят</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entry in entries"
          :key="entry.result.unit.id"
          :class="
            entry.result === lastResult && entry.result.outcome === 'ACCEPTED'
              ? 'bg-success-soft'
              : ''
          "
        >
          <td>
            <div class="d-flex align-center ga-3 py-2">
              <ProductThumbnail />
              <div class="min-w-0">
                <p class="text-title-small">{{ entry.result.unit.name }}</p>
                <ReceiptCatalogDetails :result="entry.result" />
                <p class="text-label-small text-muted">
                  {{ entry.result.unit.location ?? 'Зона приёмки' }} · 1 шт.
                </p>
              </div>
            </div>
          </td>
          <td class="text-body-small text-secondary">
            {{ entry.result.unit.maskedCode }}
          </td>
          <td>
            <v-chip color="warning-soft" class="text-warning">{{
              entry.result.outcome === 'DUPLICATE'
                ? 'Повторный скан'
                : 'На проверке'
            }}</v-chip>
          </td>
          <td class="text-body-small text-secondary">
            {{ time(entry.result.unit.receivedAt) }}
          </td>
          <td>
            <v-btn
              size="32"
              icon
              variant="text"
              aria-label="Показать экземпляры"
              @click="emit('units', entry.result.unit.variantId)"
              ><DesignIcon name="chevron"
            /></v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>
    <template v-else
      ><v-card
        v-for="entry in entries"
        :key="entry.result.unit.id"
        border
        rounded="lg"
        class="pa-2 mb-2 d-flex align-center ga-3"
        ><ProductThumbnail />
        <div class="flex-grow-1 min-w-0">
          <p class="text-title-small">{{ entry.result.unit.name }}</p>
          <ReceiptCatalogDetails :result="entry.result" />
          <p class="text-body-small text-secondary">
            1 шт. · {{ entry.result.unit.location ?? 'Зона приёмки' }}
          </p>
          <p class="text-label-small text-warning">
            {{
              entry.result.outcome === 'DUPLICATE'
                ? 'Уже добавлен'
                : 'На проверке'
            }}
            · {{ time(entry.result.unit.receivedAt) }}
          </p>
        </div>
        <v-btn
          size="32"
          icon
          variant="text"
          aria-label="Показать экземпляры"
          @click="emit('units', entry.result.unit.variantId)"
          ><DesignIcon name="chevron" /></v-btn></v-card
    ></template>
    <footer class="d-flex align-center ga-2 pa-4">
      <p class="text-label-small text-muted flex-grow-1">
        Список этой сессии. Все остатки сохраняются на сервере.
      </p>
      <v-btn variant="text" color="primary" size="small" @click="emit('stock')"
        >Все остатки</v-btn
      >
    </footer>
  </v-card>
</template>
