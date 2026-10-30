<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useDisplay } from 'vuetify';
import { mdiRefresh } from '@mdi/js';
import { useInventory } from '../composables/useInventory';
import { useIntake } from '../composables/useIntake';
import { layout } from '../design/tokens';
import DesignIcon from './DesignIcon.vue';
import ScannerCard from './ScannerCard.vue';
import ScanFeedback from './ScanFeedback.vue';
import CameraScanner from './CameraScanner.vue';
import ReceiptJournal from './ReceiptJournal.vue';
import StockBrowser from './StockBrowser.vue';
import UnitList from './UnitList.vue';
const props = defineProps<{
  initData: string;
  roles: string[];
  active?: boolean;
}>();
const { mdAndUp } = useDisplay();
const canReceive = computed(() =>
  props.roles.some((role) => ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(role)),
);
const activeTab = ref(canReceive.value ? 'intake' : 'stock');
const {
  stock,
  search,
  appliedSearch,
  offset,
  expanded,
  searchStock,
  changePage,
} = useInventory(props.initData);
const scanner = ref<InstanceType<typeof ScannerCard>>();
const {
  raw,
  processing,
  paused,
  scanError,
  errorRequestId,
  lastResult,
  entries,
  cameraOpen,
  inputDisabled,
  queueLength,
  acceptedCount,
  processQueue,
  submitScan,
  scannerKey,
  pasteScan,
  cameraScan,
} = useIntake(props.initData, canReceive, () => {
  if (props.active !== false) scanner.value?.focus();
});
const phoneHelp = ref(false);
const totals = computed(() => stock.data.value?.totals);
const metrics = computed(() => [
  {
    label: 'Всего на складе',
    value: totals.value?.onHand,
    color: 'on-surface',
    icon: 'warehouseSmall' as const,
  },
  ...(canReceive.value
    ? [
        {
          label: 'За эту приёмку',
          value: acceptedCount.value,
          color: 'primary',
          icon: 'plus' as const,
        },
      ]
    : []),
  {
    label: 'Доступно на складе',
    value: totals.value?.available,
    color: 'success',
    icon: 'check' as const,
  },
]);
const visibleMetrics = computed(() =>
  mdAndUp.value ? metrics.value : metrics.value.filter((_, index) => index < 2),
);
const format = (value: number | undefined) =>
  value === undefined ? '—' : value.toLocaleString('ru-RU');
function selectStock() {
  activeTab.value = 'stock';
}
watch(
  () => props.active,
  (active) => {
    if (active === false) cameraOpen.value = false;
  },
);
watch(activeTab, (value) => {
  if (value !== 'intake') cameraOpen.value = false;
});
watch(cameraOpen, (value) => {
  if (!value)
    void nextTick(() => {
      if (props.active !== false) scanner.value?.focus();
    });
});
</script>
<template>
  <section aria-labelledby="warehouse-title">
    <div
      class="d-none d-md-flex align-center ga-2 text-body-small text-muted mb-5"
    >
      <span>Рабочее место</span><span>/</span
      ><span class="text-secondary">Склад</span><v-spacer /><span
        class="status-dot"
        :class="stock.isError.value ? 'bg-warning' : 'bg-success'"
      /><span>{{
        stock.isError.value
          ? 'Нет соединения'
          : stock.isPending.value
            ? 'Подключаемся…'
            : 'Данные склада'
      }}</span>
    </div>
    <header class="d-flex align-center justify-space-between ga-3 mb-4 mb-md-5">
      <div>
        <p class="text-label-small text-primary mb-1 d-md-none">SHTANISHKIN</p>
        <h1 id="warehouse-title" class="text-title-large">Склад</h1>
        <p class="d-none d-md-block text-body-medium text-secondary mt-1">
          Приёмка маркированной одежды
        </p>
      </div>
      <div class="d-flex align-center ga-3">
        <span class="text-body-small text-secondary">{{
          stock.data.value?.warehouse.name ?? 'Основной склад'
        }}</span
        ><v-btn
          :icon="mdiRefresh"
          size="36"
          variant="text"
          color="secondary"
          :loading="stock.isFetching.value"
          aria-label="Обновить склад"
          @click="stock.refetch()"
        />
      </div>
    </header>
    <v-sheet
      color="surface"
      rounded="md"
      class="pa-1 mb-4 mb-md-5"
      :max-width="mdAndUp ? 400 : undefined"
    >
      <v-tabs
        v-model="activeTab"
        grow
        :show-arrows="false"
        aria-label="Раздел склада"
        ><v-tab
          v-if="canReceive"
          value="intake"
          :class="{ 'bg-raised': activeTab === 'intake' }"
          >Приёмка</v-tab
        ><v-tab value="stock" :class="{ 'bg-raised': activeTab === 'stock' }"
          >Остатки</v-tab
        ><v-tab
          v-if="canReceive"
          value="session"
          :class="{ 'bg-raised': activeTab === 'session' }"
          >Эта сессия</v-tab
        ></v-tabs
      >
    </v-sheet>
    <div class="d-flex ga-3 ga-md-4 mb-4 mb-md-6">
      <v-card
        v-for="metric in visibleMetrics"
        :key="metric.label"
        rounded="lg"
        class="pa-3 pa-md-4 flex-grow-1 min-w-0"
      >
        <div class="d-flex align-center ga-2">
          <strong
            class="text-headline-large flex-grow-1"
            :class="`text-${metric.color}`"
            >{{ format(metric.value) }}</strong
          ><DesignIcon v-if="mdAndUp" :name="metric.icon" />
        </div>
        <p class="text-label-small text-secondary">{{ metric.label }}</p>
      </v-card>
    </div>
    <v-alert v-if="stock.isError.value" type="error" class="mb-5" role="alert"
      >{{ stock.error.value?.message
      }}<v-btn class="ml-3" size="small" @click="stock.refetch()"
        >Повторить загрузку</v-btn
      ></v-alert
    >
    <div class="d-flex flex-column flex-md-row align-start ga-4 ga-md-6">
      <v-sheet
        v-if="activeTab === 'intake' && canReceive"
        :width="mdAndUp ? layout.intakeWidth : '100%'"
        :color="mdAndUp ? 'surface' : 'transparent'"
        :border="mdAndUp"
        rounded="xl"
        class="flex-shrink-0"
      >
        <ScannerCard
          ref="scanner"
          v-model="raw"
          :disabled="inputDisabled"
          :camera-open="cameraOpen"
          @submit="submitScan"
          @camera="cameraOpen = true"
          @phone="phoneHelp = true"
          @keydown="scannerKey"
          @paste="pasteScan"
        />
        <div :class="mdAndUp ? 'px-5 pb-5' : 'mt-4'">
          <v-divider v-if="mdAndUp" class="mb-4" />
          <p v-if="mdAndUp" class="text-label-small text-muted mb-3">
            Последний результат
          </p>
          <v-sheet
            v-if="scanError"
            color="error-soft"
            rounded="md"
            class="pa-4 scan-feedback"
            role="alert"
            ><p class="text-title-small text-error mb-2">
              Не удалось добавить товар
            </p>
            <p class="text-body-small">{{ scanError }}</p>
            <p
              v-if="errorRequestId"
              class="text-label-small text-secondary mt-2"
            >
              Номер обращения: {{ errorRequestId }}
            </p>
            <v-btn
              v-if="paused"
              block
              color="raised"
              class="mt-3"
              @click="processQueue()"
              >Повторить отправку</v-btn
            ></v-sheet
          >
          <ScanFeedback
            v-else
            :result="lastResult"
            :processing="processing"
            :queue-length="queueLength"
          />
          <p
            v-if="queueLength && !processing"
            class="text-label-small text-warning mt-2"
          >
            Ожидают отправки: {{ queueLength }}. Не закрывайте приложение.
          </p>
          <p
            class="text-label-small text-muted mt-3 d-none d-md-flex align-center ga-2"
          >
            <DesignIcon name="warehouseMuted" />{{
              stock.data.value?.warehouse.name ?? 'Основной склад'
            }}
            / Зона приёмки
          </p>
        </div>
      </v-sheet>
      <v-sheet min-width="0" width="100%" class="flex-grow-1">
        <ReceiptJournal
          v-if="activeTab !== 'stock'"
          :entries="entries"
          :accepted-count="acceptedCount"
          :last-result="lastResult"
          :empty-warehouse="stock.data.value?.totals.onHand === 0"
          @stock="selectStock"
          @units="expanded = $event"
        />
        <StockBrowser
          v-else
          v-model="search"
          :data="stock.data.value"
          :pending="stock.isPending.value"
          :failed="stock.isError.value"
          :offset="offset"
          :applied-search="appliedSearch"
          @search="searchStock"
          @page="changePage"
          @units="expanded = $event"
        />
        <p
          class="d-none d-md-flex align-center ga-2 text-label-small text-muted mt-5"
        >
          <DesignIcon name="info" />Товар добавляется на склад сразу после
          получения данных из Национального каталога.
        </p>
      </v-sheet>
    </div>
    <CameraScanner v-if="canReceive" v-model="cameraOpen" @scan="cameraScan" />
    <v-dialog v-model="phoneHelp" aria-labelledby="phone-title"
      ><v-card class="pa-6"
        ><h2 id="phone-title" class="text-title-medium mb-4">
          Сканирование телефоном
        </h2>
        <p class="text-body-medium text-secondary">
          Откройте этот же бот в Telegram на телефоне. В разделе «Склад →
          Приёмка» нажмите кнопку камеры и отсканируйте DataMatrix.
        </p>
        <p class="text-body-small text-secondary mt-4">
          Товар сохранится на общем складе. Остатки на ноутбуке обновляются
          автоматически каждые 15 секунд. Результат сканирования показывается на
          телефоне.
        </p>
        <v-btn
          block
          class="mt-5"
          color="primary-strong"
          @click="phoneHelp = false"
          >Понятно</v-btn
        ></v-card
      ></v-dialog
    >
    <v-dialog
      :model-value="Boolean(expanded)"
      max-width="720"
      aria-labelledby="units-title"
      @update:model-value="
        (value) => {
          if (!value) expanded = null;
        }
      "
      ><v-card class="pa-5"
        ><header class="d-flex align-center ga-3 mb-5">
          <h2 id="units-title" class="text-title-medium flex-grow-1">
            Экземпляры товара
          </h2>
          <v-btn
            size="36"
            icon
            aria-label="Закрыть экземпляры"
            @click="expanded = null"
            ><DesignIcon name="close"
          /></v-btn>
        </header>
        <UnitList
          v-if="expanded"
          :key="expanded"
          :variant-id="expanded"
          :init-data="initData" /></v-card
    ></v-dialog>
  </section>
</template>
