<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { shipmentSchema, type MarkingAction } from '@avito/contracts';
import {
  createMarkingApi,
  markingLabel,
  displayDate,
  displayMoney,
} from '../../marking-api';
import { useMarkingCommand } from '../../composables/useMarkingCommand';
import ScannerCard from '../ScannerCard.vue';
import CameraScanner from '../CameraScanner.vue';
import CommandNotice from './CommandNotice.vue';
import SimulationBanner from './SimulationBanner.vue';
import MarkingActionDialog from './MarkingActionDialog.vue';
import MarkingDocumentPanel from './MarkingDocumentPanel.vue';
const props = defineProps<{
  id: string;
  initData: string;
  roles: string[];
  active: boolean;
}>();
const emit = defineEmits<{ back: []; locked: [value: boolean] }>();
const api = createMarkingApi(props.initData);
const cmd = useMarkingCommand(props.initData);
const raw = ref('');
const camera = ref(false);
const scanner = ref<InstanceType<typeof ScannerCard>>();
const tab = ref('packing');
const dialog = ref(false);
const action = ref<MarkingAction>('handover');
const outsideRequested = ref(false);
const actionMessage = ref('');
const now = ref(Date.now());
const start = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
watch(
  () => props.active,
  (active) => {
    if (timer) clearInterval(timer);
    if (active) timer = setInterval(() => (now.value = Date.now()), 1000);
    else camera.value = false;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
const shipment = useQuery({
  queryKey: computed(() => ['marking', 'shipment', props.id]),
  queryFn: ({ signal }) =>
    api.read(`shipments/${props.id}`, shipmentSchema, signal),
  enabled: computed(() => props.active),
  refetchInterval: () =>
    props.active ? (Date.now() - start < 60000 ? 2500 : 15000) : false,
});
const data = computed(() => shipment.data.value?.data);
const packed = computed(
  () => data.value?.items.filter((i) => i.packed_at).length ?? 0,
);
const canWrite = computed(
  () =>
    props.roles.some((r) => ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(r)) &&
    shipment.data.value?.mode === 'simulation' &&
    !shipment.isError.value,
);
const expired = computed(
  () =>
    !!data.value?.prepared_at &&
    now.value - Date.parse(data.value.prepared_at) > 30 * 60000 &&
    data.value.status === 'READY',
);
const busy = computed(() => cmd.busy.value || !!cmd.pending.value);
watch(busy, (value) => emit('locked', value));
const canScan = computed(
  () =>
    canWrite.value &&
    data.value?.status === 'DRAFT' &&
    !busy.value &&
    props.active,
);
const avito = computed(() =>
  data.value?.items.some((i) => i.avito_marking_status === 'REJECTED')
    ? 'Есть ошибка'
    : data.value?.items.every((i) => i.avito_marking_status === 'ACCEPTED')
      ? 'Принято в симуляции'
      : 'Ожидает обработки',
);
const legal = computed(() =>
  data.value?.items.some((i) =>
    ['UNKNOWN_RESULT', 'MANUAL_ATTENTION'].includes(
      i.legal_operation_status ?? '',
    ),
  )
    ? 'Нужна помощь'
    : data.value?.items.some((i) =>
          [
            'PREPARING',
            'WAITING_SIGNATURE',
            'SUBMITTED',
            'PROCESSING',
          ].includes(i.legal_operation_status ?? ''),
        )
      ? 'Обрабатывается в симуляции'
      : data.value?.items.every((i) => i.legal_operation_status === 'CONFIRMED')
        ? 'Подтверждено в симуляции'
        : 'Ещё не оформлен',
);
async function scan(
  value = raw.value,
  scannerProfile: 'camera-gs1-v1' | 'keyboard-gs1-v1' = 'keyboard-gs1-v1',
) {
  if (!value || !canScan.value) return;
  camera.value = false;
  if (
    await cmd.send('pack', { shipmentId: props.id, raw: value, scannerProfile })
  ) {
    raw.value = '';
    void nextTick(() => {
      if (props.active) scanner.value?.focus();
    });
  }
}
function key(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Enter' || (event.key === 'Tab' && raw.value)) {
    event.preventDefault();
    void scan();
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
  if (value !== undefined) {
    event.preventDefault();
    raw.value = value;
  }
}
function openAction(value: MarkingAction, outside = false) {
  cmd.message.value = '';
  outsideRequested.value = outside;
  action.value = value;
  dialog.value = true;
}
async function retry() {
  if (await cmd.retry()) raw.value = '';
}
</script>
<template>
  <section class="shipment-workspace">
    <v-btn
      variant="text"
      class="px-0 mb-3"
      :disabled="busy"
      color="secondary"
      @click="$emit('back')"
      >← Очередь упаковки</v-btn
    >
    <div class="d-flex align-start ga-3 mb-4">
      <h1 class="text-title-large text-break">
        Посылка {{ data?.parcel_code ?? '' }}
      </h1>
      <v-spacer /><v-btn
        :loading="shipment.isFetching.value"
        @click="shipment.refetch()"
        >Обновить</v-btn
      >
    </div>
    <SimulationBanner
      v-if="shipment.data.value"
      :mode="shipment.data.value.mode"
      :simulated="shipment.data.value.simulated"
    /><v-progress-linear
      v-if="shipment.isPending.value"
      indeterminate
    /><v-alert v-if="shipment.isError.value" type="error" class="mb-4"
      >Не удалось обновить карточку.<span v-if="data">
        Показаны устаревшие данные.</span
      ><v-btn @click="shipment.refetch()">Повторить</v-btn></v-alert
    ><CommandNotice
      :error="cmd.error.value"
      :message="cmd.message.value"
      :busy="cmd.busy.value"
      :uncertain="!!cmd.pending.value"
      @retry="retry"
    /><v-alert v-if="actionMessage" color="success" class="mb-4">{{
      actionMessage
    }}</v-alert
    ><template v-if="data"
      ><v-chip class="text-primary mb-4" color="primary-soft">{{
        markingLabel(data.status)
      }}</v-chip>
      <p class="text-body-small text-secondary mb-4">
        Подготовка: {{ displayDate(data.prepared_at) }} · Передача:
        {{ displayDate(data.handed_over_at) }}
      </p>
      <v-tabs v-model="tab" class="mb-5"
        ><v-tab value="packing">Упаковка</v-tab
        ><v-tab value="documents">Документы</v-tab></v-tabs
      ><MarkingDocumentPanel
        v-if="tab === 'documents'"
        :init-data="initData"
        :roles="roles"
        :active="active"
        :unit-ids="data.items.map((i) => i.unit_id)" /><v-row v-else
        ><v-col cols="12" md="8" order="2" order-md="1"
          ><v-card class="pa-4 pa-md-6 mb-4"
            ><h2 class="text-title-medium mb-4">Состав посылки</h2>
            <v-sheet
              v-for="item in data.items"
              :key="item.shipment_item_id"
              class="mb-3 pa-4"
              rounded="md"
              color="raised"
              ><h3 class="text-title-small">{{ item.name }}</h3>
              <p class="text-body-medium mt-2">
                {{ item.size_label ?? 'Размер не указан' }} ·
                {{ item.color ?? 'Цвет не указан' }}
              </p>
              <p class="text-body-small text-secondary mt-2">
                {{ item.masked_code }} ·
                {{ displayMoney(item.unit_price_kopecks) }}
              </p>
              <p class="text-body-small mt-2">
                Склад: {{ markingLabel(item.physical_state) }} · ЧЗ:
                {{ markingLabel(item.legal_state) }}
              </p>
              <p
                class="text-body-small mt-2"
                :class="item.packed_at ? 'text-success' : 'text-secondary'"
              >
                {{
                  item.packed_at
                    ? `Отсканировано ${displayDate(item.packed_at)}`
                    : 'Ожидает сканирования'
                }}
                · Авито: {{ markingLabel(item.avito_marking_status) }}
              </p></v-sheet
            ></v-card
          ><ScannerCard
            v-if="data.status === 'DRAFT' && canWrite"
            ref="scanner"
            v-model="raw"
            purpose="pack"
            :disabled="!canScan"
            :camera-open="camera"
            @submit="scan()"
            @camera="camera = true"
            @phone="camera = true"
            @keydown="key"
            @paste="paste" /></v-col
        ><v-col cols="12" md="4" order="1" order-md="2"
          ><v-card class="pa-4 pa-md-6 mb-4"
            ><h2 class="text-title-medium mb-4">Прогресс</h2>
            <p class="text-title-large mb-3" data-testid="packing-progress">
              {{ packed }} из {{ data.items.length }}
            </p>
            <v-progress-linear
              :model-value="
                data.items.length ? (packed / data.items.length) * 100 : 0
              "
              color="primary"
              height="6"
              rounded
              class="mb-4"
            />
            <p class="text-body-medium">Авито: {{ avito }}</p>
            <p class="text-body-medium mt-3">ЧЗ: {{ legal }}</p>
            <p
              v-if="data.status === 'DRAFT' && packed === data.items.length"
              class="text-body-small text-secondary mt-3"
            >
              Маркировки передаются автоматически. Дополнительный скан не нужен.
            </p>
            <p
              v-if="data.prepared_at && data.status === 'PACKED'"
              class="text-body-small text-secondary mt-3"
            >
              Оформляем ЧЗ. Можно закрыть экран — обработка продолжится.
            </p></v-card
          ><v-alert v-if="expired" type="warning" class="mb-4"
            >Подготовка просрочена. Проверьте посылку вместе с
            владельцем.</v-alert
          >
          <div v-if="canWrite" class="shipment-action-bar">
            <v-card class="pa-4"
              ><template v-if="data.status === 'PACKED' && !data.prepared_at"
                ><p class="text-body-small text-secondary mb-3">
                  Подготовьте непосредственно перед передачей. Срок готовности —
                  30 минут.
                </p>
                <v-btn
                  block
                  color="primary-strong"
                  :disabled="busy"
                  @click="cmd.send('prepare', { shipmentId: id })"
                  >Подготовить к передаче</v-btn
                ></template
              ><v-btn
                v-else-if="data.status === 'READY'"
                block
                color="primary-strong"
                :disabled="busy || expired || !data.prepared_at"
                @click="openAction('handover')"
                >Передал перевозчику</v-btn
              ><v-btn
                v-if="['HANDED_OVER', 'DELIVERED'].includes(data.status)"
                block
                :disabled="busy"
                @click="openAction('return')"
                >Принять возврат</v-btn
              >
              <v-menu v-if="!data.handed_over_at && data.status !== 'CANCELLED'"
                ><template #activator="{ props: menuProps }"
                  ><v-btn
                    v-bind="menuProps"
                    block
                    variant="text"
                    class="mt-2"
                    :disabled="busy"
                    color="secondary"
                    >Другие действия</v-btn
                  ></template
                ><v-list
                  ><v-list-item
                    title="Отменить отгрузку"
                    @click="openAction('cancel')" /><v-list-item
                    title="Уже передано вне приложения"
                    @click="openAction('handover', true)" /></v-list
              ></v-menu>
            </v-card></div></v-col></v-row></template
    ><CameraScanner
      v-model="camera"
      @scan="(value) => scan(value, 'camera-gs1-v1')"
    /><MarkingActionDialog
      v-model="dialog"
      :action="action"
      :outside-default="outsideRequested"
      :entity-id="id"
      :init-data="initData"
      @done="
        actionMessage =
          action === 'return'
            ? 'Возврат получен. Исправная вещь будет доступна только после юридического восстановления.'
            : 'Событие сохранено в тестовом процессе.';
        shipment.refetch();
      "
    />
  </section>
</template>
<style scoped>
.shipment-action-bar {
  position: sticky;
  bottom: calc(90px + env(safe-area-inset-bottom, 0px));
  z-index: 2;
}
@media (min-width: 960px) {
  .shipment-action-bar {
    bottom: 24px;
  }
}
@media (max-width: 959px) {
  .shipment-action-bar {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  }
  .shipment-workspace {
    padding-bottom: 220px;
  }
}
</style>
