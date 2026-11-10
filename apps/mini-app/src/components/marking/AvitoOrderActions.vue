<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  avitoActionsResponseSchema,
  avitoActionQueuedSchema,
  avitoActionCommandSchema,
  courierOptionsSchema,
  type AvitoActionCommandDto,
  type MarketplaceOrderDto,
} from '@avito/contracts';
import { createOrderActionsApi } from '../../order-actions-api';
const props = defineProps<{
  order: MarketplaceOrderDto;
  initData: string;
  roles: string[];
}>();
const emit = defineEmits<{ updated: []; packing: [] }>();
const api = createOrderActionsApi(props.initData),
  client = useQueryClient();
const actions = useQuery({
  queryKey: computed(() => ['avito-actions', props.order.id]),
  queryFn: async () =>
    avitoActionsResponseSchema.parse(await api.get(props.order.id, 'actions')),
  refetchInterval: 5000,
  retry: false,
});
watch(
  () =>
    actions.data.value?.operations
      .filter((o) => ['SUCCEEDED', 'MANUAL_ATTENTION'].includes(o.status))
      .map((o) => o.id + ':' + o.status)
      .join('|'),
  (value, previous) => {
    if (previous !== undefined && value !== previous) emit('updated');
  },
);
const names: Record<string, string> = {
  confirm: 'Подтвердить заказ',
  reject: 'Отменить заказ',
  perform: 'Подтвердить отправку',
  receive: 'Подтвердить доставку',
  setMarkings: 'Передать маркировку',
  setTrackNumber: 'Указать трек-номер',
  fixTrackNumber: 'Исправить трек-номер',
  acceptReturnOrder: 'Выбрать отделение для возврата',
  setCNCDetails: 'Подготовить самовывоз',
  setCourierDeliveryRange: 'Вызвать курьера',
  label: 'Этикетка PDF',
};
const canWrite = computed(() =>
  props.roles.some((r) => ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(r)),
);
const working = computed(() =>
  actions.data.value?.operations.some(
    (o) =>
      ['PENDING', 'RUNNING', 'RETRY_SCHEDULED'].includes(o.status) ||
      o.reconcilable,
  ),
);
const disabled = computed(
  () =>
    !canWrite.value ||
    !actions.data.value?.writesEnabled ||
    working.value ||
    actions.isError.value,
);
const selected = ref(''),
  busy = ref(false),
  error = ref(''),
  message = ref('');
const fields = reactive<Record<string, string>>({});
const intervals = ref<
  {
    title: string;
    value: string;
    startDate: string;
    endDate: string;
    type: string;
  }[]
>([]);
const interval = ref('');
let command: AvitoActionCommandDto | undefined;
const simple = computed(() =>
  ['confirm', 'reject', 'perform'].includes(selected.value),
);
function open(action: string) {
  selected.value = action;
  error.value = '';
  command = undefined;
  interval.value = '';
  intervals.value = [];
  for (const key of Object.keys(fields)) delete fields[key];
}
function payload(): unknown {
  const a = selected.value;
  const data =
    a === 'setTrackNumber' || a === 'fixTrackNumber'
      ? { trackingNumber: fields.trackingNumber }
      : a === 'acceptReturnOrder'
        ? {
            terminalNumber: fields.terminalNumber,
            name: fields.name,
            phone: fields.phone,
          }
        : a === 'setCNCDetails'
          ? {
              address: fields.address,
              details: fields.details ?? '',
              bookingPeriod: Number(fields.bookingPeriod),
            }
          : a === 'receive' && fields.confirmCode
            ? { confirmCode: fields.confirmCode }
            : a === 'setCourierDeliveryRange'
              ? {
                  address: fields.address,
                  addressDetails: fields.addressDetails ?? '',
                  name: fields.name,
                  phone: fields.phone,
                  startDate: intervals.value.find(
                    (i) => i.value === interval.value,
                  )?.startDate,
                  endDate: intervals.value.find(
                    (i) => i.value === interval.value,
                  )?.endDate,
                  intervalType: intervals.value.find(
                    (i) => i.value === interval.value,
                  )?.type,
                }
              : {};
  return { action: a, data };
}
async function send() {
  busy.value = true;
  error.value = '';
  try {
    const next = payload();
    if (
      !command ||
      JSON.stringify({ action: command.action, data: command.data }) !==
        JSON.stringify(next)
    ) {
      const parsed = avitoActionCommandSchema.safeParse({
        requestId: crypto.randomUUID(),
        ...(next as object),
      });
      if (!parsed.success) {
        error.value = 'Заполните обязательные поля корректно.';
        return;
      }
      command = parsed.data;
    }
    avitoActionQueuedSchema.parse(await api.post(props.order.id, command));
    message.value =
      'Действие поставлено в очередь. Результат появится здесь автоматически.';
    selected.value = '';
    command = undefined;
    await client.invalidateQueries({
      queryKey: ['avito-actions', props.order.id],
    });
    emit('updated');
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Не удалось отправить действие.';
  } finally {
    busy.value = false;
  }
}
async function loadIntervals() {
  busy.value = true;
  error.value = '';
  try {
    const result = courierOptionsSchema.parse(
      await api.courier(props.order.id, fields.address),
    );
    for (const key of ['address', 'addressDetails', 'name', 'phone'] as const)
      if (!fields[key] && result[key]) fields[key] = result[key];
    intervals.value = result.dateOptions.flatMap((d) =>
      d.timeIntervals
        .filter((i) => ['fixed', 'asap'].includes(i.type))
        .map((i) => ({
          ...i,
          title: `${new Date(d.date).toLocaleDateString('ru-RU')} · ${i.title}`,
          value: i.startDate + ':' + i.endDate + ':' + i.type,
        })),
    );
    if (!intervals.value.length)
      error.value = 'Авито пока не вернул доступное время приезда курьера.';
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Не удалось получить время курьера.';
  } finally {
    busy.value = false;
  }
}
async function download(id: string) {
  try {
    await api.download(props.order.id, id);
    message.value = 'Этикетка скачана.';
  } catch (e) {
    message.value =
      e instanceof Error ? e.message : 'Не удалось скачать этикетку.';
  }
}
async function reconcile(id: string) {
  try {
    await api.reconcile(props.order.id, id);
    await actions.refetch();
    emit('updated');
  } catch (e) {
    message.value =
      e instanceof Error ? e.message : 'Не удалось проверить результат.';
  }
}
const status = (s: string) =>
  ({
    PENDING: 'В очереди',
    RUNNING: 'Выполняется',
    RETRY_SCHEDULED: 'Повтор после ограничения Авито',
    SUCCEEDED: 'Подтверждено Авито',
    MANUAL_ATTENTION: 'Требует проверки результата',
    CANCELLED: 'Отменено',
  })[s] ?? s;
</script>
<template>
  <v-card class="pa-4 pa-md-6" data-testid="avito-actions">
    <h2 class="text-title-medium mb-3">Действия в Авито</h2>
    <v-alert v-if="actions.isError.value" type="error" class="mb-3"
      >Не удалось получить состояние действий.<v-btn
        variant="text"
        @click="actions.refetch()"
        >Обновить действия</v-btn
      ></v-alert
    >
    <p
      v-if="canWrite && actions.data.value && !actions.data.value.writesEnabled"
      class="text-body-small text-secondary mb-3"
    >
      Отправка действий в Авито выключена владельцем на сервере.
    </p>
    <p v-if="!canWrite" class="text-body-small text-secondary mb-3">
      Действия доступны сотруднику склада и владельцу.
    </p>
    <div class="d-flex flex-column ga-3">
      <template v-for="a in order.availableActions" :key="a.name">
        <v-btn
          v-if="a.name === 'setMarkings'"
          block
          :disabled="!canWrite"
          @click="emit('packing')"
          >{{ names[a.name] }}</v-btn
        >
        <v-btn
          v-else-if="names[a.name]"
          block
          :disabled="disabled"
          :color="
            a.name === 'confirm'
              ? 'primary-strong'
              : a.name === 'reject'
                ? 'error-soft'
                : 'raised'
          "
          @click="open(a.name)"
          >{{ names[a.name] }}{{ a.required ? ' · обязательно' : '' }}</v-btn
        >
        <p v-else class="text-body-small">
          {{ a.name }}: Авито добавил новое действие, требуется обновление
          приложения.
        </p>
      </template>
      <v-btn
        v-if="['on_confirmation', 'ready_to_ship'].includes(order.status)"
        :disabled="disabled"
        block
        @click="open('setCourierDeliveryRange')"
        >Вызвать курьера</v-btn
      >
      <v-btn
        v-if="
          order.delivery.serviceType === 'pvz' &&
          order.marketplaceId &&
          !['canceled', 'closed'].includes(order.status)
        "
        :disabled="disabled"
        block
        @click="open('label')"
        >Этикетка PDF</v-btn
      >
    </div>
    <p
      v-if="order.availableActions.some((a) => a.name === 'setMarkings')"
      class="text-body-small text-secondary mt-3"
    >
      Коды передаются автоматически после сканирования всех вещей в «Упаковке».
    </p>
    <v-alert v-if="message" class="mt-4" aria-live="polite">{{
      message
    }}</v-alert>
    <div
      v-for="op in actions.data.value?.operations"
      :key="op.id"
      class="mt-4 text-body-small"
      aria-live="polite"
    >
      <p>{{ names[op.action] ?? op.action }} · {{ status(op.status) }}</p>
      <p
        v-if="op.errorCode && op.status === 'MANUAL_ATTENTION'"
        class="text-warning mt-1"
      >
        {{
          op.errorCode === 'AVITO_ACTION_RESULT_UNKNOWN'
            ? 'Авито мог выполнить действие. Повторная отправка заблокирована; обновите заказ и проверьте результат.'
            : op.errorCode === 'ORDER_ACTION_UNAVAILABLE'
              ? 'Авито больше не разрешает действие. Обновите заказ.'
              : op.errorCode === 'AVITO_ACTION_REJECTED'
                ? 'Авито отклонил действие. Проверьте данные заказа.'
                : op.errorCode === 'ORDER_ACTIONS_DISABLED'
                  ? 'Владелец выключил отправку действий.'
                  : 'Не удалось подтвердить действие. Обновите заказ или обратитесь к владельцу.'
        }}
      </p>
      <p
        v-if="op.action === 'reject' && op.status === 'SUCCEEDED'"
        class="text-secondary mt-2"
      >
        Если заказ уже собирался, отмените его отгрузку в «Упаковке» после
        проверки наличия вещей.
      </p>
      <v-btn
        v-if="canWrite && op.reconcilable"
        class="mt-2"
        @click="reconcile(op.id)"
        >Проверить результат</v-btn
      >
      <v-btn v-if="op.labelReady" class="mt-2" @click="download(op.id)"
        >Скачать этикетку</v-btn
      >
    </div>
  </v-card>
  <v-dialog
    :model-value="!!selected"
    max-width="560"
    :persistent="busy"
    @update:model-value="!$event && (selected = '')"
  >
    <v-card class="pa-5">
      <h2 class="text-title-medium mb-4">{{ names[selected] }}</h2>
      <p v-if="simple || selected === 'label'" class="text-body-medium mb-4">
        {{
          selected === 'reject'
            ? 'Заказ будет отменён в Авито. Складской резерв снимается отдельно после проверки вещей.'
            : selected === 'perform'
              ? 'Подтверждайте только фактически отправленный заказ.'
              : selected === 'label'
                ? 'Авито сформирует PDF для этой посылки.'
                : 'Подтвердить заказ в Авито?'
        }}
      </p>
      <div class="d-flex flex-column ga-3">
        <v-text-field
          v-if="['setTrackNumber', 'fixTrackNumber'].includes(selected)"
          v-model="fields.trackingNumber"
          label="Трек-номер"
          :disabled="busy"
        />
        <v-text-field
          v-if="selected === 'acceptReturnOrder'"
          v-model="fields.terminalNumber"
          label="Индекс отделения Почты России"
          :disabled="busy"
        />
        <template
          v-if="
            ['acceptReturnOrder', 'setCourierDeliveryRange'].includes(selected)
          "
          ><v-text-field
            v-model="fields.name"
            label="ФИО получателя"
            :disabled="busy" /><v-text-field
            v-model="fields.phone"
            label="Телефон с кодом страны"
            :disabled="busy"
        /></template>
        <template
          v-if="['setCNCDetails', 'setCourierDeliveryRange'].includes(selected)"
          ><v-text-field
            v-model="fields.address"
            label="Адрес"
            :disabled="busy" /><v-text-field
            v-model="fields.addressDetails"
            label="Уточнение адреса"
            :disabled="busy"
        /></template>
        <template v-if="selected === 'setCNCDetails'"
          ><v-text-field
            v-model="fields.bookingPeriod"
            type="number"
            label="Срок бронирования, дней"
            :disabled="busy" /><v-text-field
            v-model="fields.details"
            label="Сообщение покупателю"
            :disabled="busy"
        /></template>
        <template v-if="selected === 'setCourierDeliveryRange'"
          ><v-btn :loading="busy" @click="loadIntervals"
            >Показать время курьера</v-btn
          ><v-select
            v-model="interval"
            :items="intervals"
            label="Время приезда"
            :disabled="busy"
        /></template>
        <template v-if="selected === 'receive'"
          ><p class="text-body-small">
            Подтверждайте только фактическое получение покупателем.
          </p>
          <v-text-field
            v-if="
              !['pvz', 'dbs', 'rdbs'].includes(order.delivery.serviceType ?? '')
            "
            v-model="fields.confirmCode"
            label="Код покупателя"
            :disabled="busy"
        /></template>
      </div>
      <v-alert v-if="error" type="error" class="mt-4" role="alert">{{
        error
      }}</v-alert>
      <div class="d-flex flex-wrap ga-3 mt-5">
        <v-btn
          color="primary-strong"
          :loading="busy"
          :disabled="disabled"
          @click="send"
          >{{ command ? 'Повторить запрос' : 'Подтвердить' }}</v-btn
        ><v-btn :disabled="busy" variant="text" @click="selected = ''"
          >Закрыть</v-btn
        >
      </div>
    </v-card>
  </v-dialog>
</template>
<style scoped>
[data-testid='avito-actions'] .v-btn {
  height: auto;
  min-height: 44px;
  padding-block: 10px;
}
[data-testid='avito-actions'] :deep(.v-btn__content) {
  white-space: normal;
}
</style>
