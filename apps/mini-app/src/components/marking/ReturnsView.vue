<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { returnReceiptsSchema } from '@avito/contracts';
import { useDisplay } from 'vuetify';
import { mdiPackageVariantClosed, mdiRefresh, mdiUndoVariant } from '@mdi/js';
import ScannerCard from '../ScannerCard.vue';
import CameraScanner from '../CameraScanner.vue';
import CommandNotice from './CommandNotice.vue';
import { useMarkingCommand } from '../../composables/useMarkingCommand';
import { createOrdersApi } from '../../orders-api';
import { createMarkingApi, displayDate, markingLabel } from '../../marking-api';

const props = defineProps<{
  initData: string;
  active: boolean;
  roles: string[];
}>();
const emit = defineEmits<{ openOrder: [id: string] }>();
const canReceive = computed(() =>
  props.roles.some((role) => ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(role)),
);
const ordersApi = createOrdersApi(props.initData);
const markingApi = createMarkingApi(props.initData);
const queryClient = useQueryClient();
const { mdAndUp } = useDisplay();
const page = ref(1);
const orders = useQuery({
  queryKey: computed(() => ['avito-orders', 'on_return', page.value]),
  queryFn: ({ signal }) =>
    ordersApi.list({ page: page.value, status: 'on_return' }, signal),
  enabled: computed(() => props.active),
  retry: false,
  refetchInterval: 30000,
});
const receipts = useQuery({
  queryKey: ['marking', 'returns'],
  queryFn: ({ signal }) =>
    markingApi.read('returns', returnReceiptsSchema, signal),
  enabled: computed(() => props.active),
  refetchInterval: computed(() => (props.active ? 5000 : false)),
});
watch(
  () => receipts.data.value?.data,
  (current, previous) => {
    if (
      current?.some(
        (row) =>
          row.status === 'COMPLETED' &&
          previous?.some(
            (old) => old.id === row.id && old.status !== 'COMPLETED',
          ),
      )
    ) {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-units'] });
    }
  },
);
const cmd = useMarkingCommand(props.initData);
const raw = ref('');
const camera = ref(false);
const scanner = ref<InstanceType<typeof ScannerCard>>();
const condition = ref<'GOOD' | 'DEFECTIVE' | 'DAMAGED_CODE'>('GOOD');
const receivedNotice = ref('');
const locked = computed(
  () => !canReceive.value || cmd.busy.value || !!cmd.pending.value,
);
watch(
  () => props.active,
  (active) => {
    if (!active) camera.value = false;
  },
);
const returnShippingStatus: Record<string, string> = {
  in_transit: 'Возврат в пути',
  ready_to_pickup: 'Можно забрать',
  self_return: 'Самостоятельный возврат',
};
const receiptStatus = {
  COMPLETED: { label: 'Принято на склад', color: 'success' },
  PENDING_CHZ: { label: 'Ожидает ЧЗ', color: 'primary' },
  AWAITING_CHZ_RETURN: { label: 'Ожидает возврата в ЧЗ', color: 'warning' },
  REVIEW: { label: 'Нужна проверка', color: 'warning' },
} as const;

function resetScan() {
  raw.value = '';
  condition.value = 'GOOD';
  if (props.active && mdAndUp.value) scanner.value?.focus();
}
function finish(accepted: boolean) {
  if (!accepted) return;
  receivedNotice.value =
    'Приёмка сохранена. Результат появится в списке приёмок.';
  resetScan();
}
async function receive(
  value = raw.value,
  scannerProfile: 'camera-gs1-v1' | 'keyboard-gs1-v1' = 'keyboard-gs1-v1',
) {
  if (!value || locked.value || !props.active) return;
  receivedNotice.value = '';
  camera.value = false;
  finish(
    await cmd.send('scanReturn', {
      raw: value,
      scannerProfile,
      occurredAt: new Date().toISOString(),
      condition: condition.value,
    }),
  );
}
async function retry() {
  finish(await cmd.retry());
}
function key(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Enter' || (event.key === 'Tab' && raw.value)) {
    event.preventDefault();
    void receive();
  }
  if (event.ctrlKey && (event.key === ']' || event.code === 'BracketRight')) {
    event.preventDefault();
    const input = event.target as HTMLInputElement;
    const from = input.selectionStart ?? raw.value.length;
    const to = input.selectionEnd ?? from;
    raw.value = raw.value.slice(0, from) + '\u001d' + raw.value.slice(to);
    queueMicrotask(() => input.setSelectionRange(from + 1, from + 1));
  }
}
function paste(event: ClipboardEvent) {
  const value = event.clipboardData?.getData('text');
  if (value === undefined) return;
  event.preventDefault();
  raw.value = value;
}
</script>

<template>
  <section aria-labelledby="returns-title">
    <div
      class="d-flex align-start align-sm-center justify-space-between flex-wrap ga-3 mb-6"
    >
      <div>
        <h1 id="returns-title" class="text-title-large">Возвраты</h1>
        <p class="text-body-medium text-secondary mt-1">
          Приёмка вещей, которые уже вернулись на склад.
        </p>
      </div>
      <v-btn
        variant="outlined"
        color="secondary"
        :prepend-icon="mdiRefresh"
        :loading="orders.isFetching.value || receipts.isFetching.value"
        @click="
          orders.refetch();
          receipts.refetch();
        "
        >Обновить</v-btn
      >
    </div>

    <div class="returns-layout">
      <div class="min-w-0">
        <template v-if="canReceive">
          <CommandNotice
            :error="cmd.error.value"
            :busy="cmd.busy.value"
            :message="receivedNotice"
            :uncertain="!!cmd.pending.value"
            @retry="retry"
          />
          <ScannerCard
            ref="scanner"
            v-model="raw"
            purpose="return"
            :disabled="locked"
            :camera-open="camera"
            @submit="receive()"
            @camera="camera = true"
            @keydown="key"
            @paste="paste"
          />
          <v-select
            v-model="condition"
            :items="[
              { title: 'Всё в порядке', value: 'GOOD' },
              { title: 'Брак', value: 'DEFECTIVE' },
              { title: 'Повреждена маркировка', value: 'DAMAGED_CODE' },
            ]"
            label="Состояние вещи"
            :disabled="locked"
            hide-details
            class="mt-3"
          />
        </template>

        <v-card
          v-if="receipts.isError.value || receipts.data.value?.data.length"
          border
          class="pa-4 pa-md-5 mt-4"
        >
          <h2 class="text-title-medium mb-3">Последние приёмки</h2>
          <v-alert v-if="receipts.isError.value" type="warning" variant="tonal"
            >Не удалось обновить результаты приёмки.</v-alert
          >
          <div
            v-for="item in receipts.data.value?.data"
            :key="item.id"
            class="return-row py-3"
          >
            <div class="min-w-0">
              <p class="text-title-small text-break">{{ item.name }}</p>
              <p class="text-body-small text-secondary mt-1 text-break">
                №{{ item.marketplace_order_id || item.external_order_id }} ·
                {{ displayDate(item.received_at) }}
              </p>
              <p
                v-if="item.status === 'PENDING_CHZ' && item.legal_status"
                class="text-body-small text-secondary mt-1"
              >
                {{ markingLabel(item.legal_status) }}
              </p>
              <a
                v-if="item.status === 'AWAITING_CHZ_RETURN'"
                href="https://markirovka.crpt.ru/"
                target="_blank"
                rel="noopener noreferrer"
                class="text-body-small text-primary d-inline-block mt-1"
                >Открыть личный кабинет ЧЗ</a
              >
            </div>
            <v-chip size="small" :color="receiptStatus[item.status].color">{{
              receiptStatus[item.status].label
            }}</v-chip>
          </div>
        </v-card>
      </div>

      <v-card
        border
        class="pa-4 pa-md-6 min-w-0"
        aria-labelledby="returns-orders-title"
      >
        <div class="d-flex align-center ga-3 flex-wrap mb-4">
          <v-icon :icon="mdiUndoVariant" color="primary" />
          <h2 id="returns-orders-title" class="text-title-medium">
            На возврате в Авито
          </h2>
          <v-chip
            v-if="orders.data.value?.orders.length"
            size="small"
            color="primary"
            >{{ orders.data.value.orders.length
            }}{{ orders.data.value.hasMore ? '+' : '' }}</v-chip
          >
        </div>
        <v-progress-linear
          v-if="orders.isPending.value"
          indeterminate
          color="primary"
        />
        <v-alert v-if="orders.isError.value" type="warning" variant="tonal">{{
          orders.error.value?.message
        }}</v-alert>
        <p
          v-else-if="
            orders.isSuccess.value && !orders.data.value?.orders.length
          "
          class="text-body-medium text-secondary py-5"
        >
          Заказов на возврате пока нет.
        </p>
        <v-list v-else bg-color="transparent" class="pa-0">
          <v-list-item
            v-for="order in orders.data.value?.orders"
            :key="order.id"
            :prepend-icon="mdiPackageVariantClosed"
            :title="order.items.map((i) => i.title).join(', ') || 'Заказ Авито'"
            :subtitle="
              [
                `№${order.marketplaceId || order.id}`,
                order.returnPolicy?.trackingNumber
                  ? `Трек ${order.returnPolicy.trackingNumber}`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')
            "
            rounded="md"
            color="primary"
            class="return-order bg-raised mb-2"
            @click="emit('openOrder', order.id)"
          >
            <template #append>
              <v-chip
                :color="
                  order.returnPolicy?.returnStatus === 'ready_to_pickup'
                    ? 'success'
                    : 'warning'
                "
                size="small"
                >{{
                  returnShippingStatus[
                    order.returnPolicy?.returnStatus ?? ''
                  ] ?? 'На возврате'
                }}</v-chip
              >
            </template>
          </v-list-item>
        </v-list>
        <div
          v-if="page > 1 || orders.data.value?.hasMore"
          class="d-flex justify-space-between mt-3 ga-2"
        >
          <v-btn variant="text" :disabled="page === 1" @click="page--"
            >Назад</v-btn
          >
          <v-btn
            variant="text"
            :disabled="!orders.data.value?.hasMore"
            @click="page++"
            >Далее</v-btn
          >
        </div>
      </v-card>
    </div>

    <CameraScanner
      v-model="camera"
      @scan="(value) => receive(value, 'camera-gs1-v1')"
    />
  </section>
</template>

<style scoped>
.returns-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.return-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.return-row + .return-row {
  border-top: 1px solid rgb(var(--v-theme-border));
}
.return-order :deep(.v-list-item-subtitle) {
  opacity: 1;
  color: rgb(var(--v-theme-secondary));
}
@media (min-width: 960px) {
  .returns-layout {
    grid-template-columns: minmax(280px, 384px) minmax(0, 1fr);
    gap: 24px;
  }
}
</style>
