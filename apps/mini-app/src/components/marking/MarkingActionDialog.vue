<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MarkingAction } from '@avito/contracts';
import { useMarkingCommand } from '../../composables/useMarkingCommand';
import CommandNotice from './CommandNotice.vue';
import CameraScanner from '../CameraScanner.vue';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  action: MarkingAction;
  entityId?: string;
  initData: string;
  defaults?: Record<string, string>;
  outsideDefault?: boolean;
}>();
const emit = defineEmits<{ done: [] }>();
const cmd = useMarkingCommand(props.initData);
const f = ref<Record<string, string>>({});
const checked = ref(false);
const outside = ref(false);
const camera = ref(false);
const bulk = ref('');
const invalid = ref('');
const scannerProfile = ref<'camera-gs1-v1' | 'keyboard-gs1-v1'>(
  'keyboard-gs1-v1',
);
const titles: Partial<Record<MarkingAction, string>> = {
  handover: 'Подтверждение передачи',
  return: 'Принять возврат',
  cancel: 'Отменить посылку',
  dispose: 'Утрата / уничтожение',
  calendar: 'Календарь рабочих дней',
  supply: 'Документы поставщика',
  retry: 'Повтор фоновой операции',
  correctDocument: 'Исправить отклонённые строки',
};
const hasDocument = computed(
  () =>
    props.action === 'dispose' ||
    (props.action === 'return' && f.value.paid === 'true'),
);
const fields = computed<[string, string][]>(() => {
  switch (props.action) {
    case 'supply':
      return [
        ['documentNumber', 'Номер документа поставщика'],
        ['documentDate', 'Дата документа'],
        ['supplierInn', 'ИНН поставщика'],
        ['evidenceReference', 'Идентификатор УПД в Честном знаке'],
      ];
    case 'handover':
      return [['evidenceReference', 'Номер или ссылка подтверждения передачи']];
    case 'return':
      return [
        ['evidenceReference', 'Подтверждение получения возврата'],
        ['note', 'Комментарий (необязательно)'],
      ];
    case 'dispose':
      return [['evidenceReference', 'Ссылка на акт']];
    case 'cancel':
    case 'retry':
    case 'correctDocument':
      return [['reason', 'Причина']];
    default:
      return [];
  }
});
watch(open, (value) => {
  if (value && !cmd.pending.value) {
    cmd.error.value = undefined;
    cmd.message.value = '';
    scannerProfile.value = 'keyboard-gs1-v1';
    f.value = {
      ...props.defaults,
      kind: 'CUSTOMER',
      condition: 'GOOD',
      paid: '',
      occurredAt:
        props.action === 'return' || props.action === 'dispose'
          ? new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16)
          : '',
      reason: props.action === 'dispose' ? 'LOSS' : '',
    };
    checked.value = false;
    outside.value = props.outsideDefault ?? false;
    bulk.value = '';
    invalid.value = '';
  }
  if (!value) camera.value = false;
});
async function submit() {
  invalid.value = '';
  if (cmd.pending.value) return;
  let payload: Record<string, unknown>;
  if (props.action === 'calendar') {
    try {
      const days: unknown = JSON.parse(bulk.value);
      payload = { days };
    } catch {
      invalid.value = 'Загрузите массив дат в формате JSON.';
      return;
    }
  } else if (props.action === 'supply')
    payload = {
      documentNumber: f.value.documentNumber,
      documentDate: f.value.documentDate,
      supplierInn: f.value.supplierInn,
      evidenceReference: f.value.evidenceReference,
      unitIds: bulk.value.split(/[\s,;]+/).filter(Boolean),
    };
  else if (['retry', 'correctDocument'].includes(props.action))
    payload = {
      reason: f.value.reason,
      [props.action === 'retry' ? 'operationId' : 'documentId']: props.entityId,
    };
  else if (props.action === 'cancel') {
    if (!checked.value) {
      invalid.value = 'Подтвердите физическое наличие всех вещей.';
      return;
    }
    payload = {
      shipmentId: props.entityId,
      reason: f.value.reason,
      physicalPresenceConfirmed: true,
    };
  } else {
    if (!checked.value) {
      invalid.value = 'Подтвердите фактическое событие.';
      return;
    }
    const at =
      outside.value || props.action !== 'handover'
        ? new Date(f.value.occurredAt ?? '').getTime()
        : Date.now();
    if (!Number.isFinite(at)) {
      invalid.value = 'Укажите фактическую дату и время.';
      return;
    }
    payload = {
      occurredAt: new Date(at).toISOString(),
      evidenceReference: f.value.evidenceReference,
    };
    if (props.action === 'handover')
      Object.assign(payload, {
        shipmentId: props.entityId,
        occurredOutsideApp: outside.value,
      });
    if (props.action === 'return') {
      if (!['true', 'false'].includes(f.value.paid ?? '')) {
        invalid.value = 'Уточните факт оплаты. Не выбирайте значение наугад.';
        return;
      }
      Object.assign(payload, {
        shipmentId: props.entityId,
        raw: f.value.raw,
        scannerProfile: scannerProfile.value,
        kind: f.value.kind,
        condition: f.value.condition,
        paid: f.value.paid === 'true',
        note: f.value.note || `Приём возврата: ${f.value.condition}`,
      });
    }
    if (props.action === 'dispose')
      Object.assign(payload, {
        unitId: props.entityId,
        reason: f.value.reason,
        confirmation: 'CONFIRM_IRREVERSIBLE',
      });
    if (hasDocument.value)
      payload.primaryDocument = {
        number: f.value.number,
        date: f.value.date,
        name: f.value.name,
      };
  }
  if (await cmd.send(props.action, payload)) {
    f.value.raw = '';
    emit('done');
    open.value = false;
  }
}
async function retry() {
  if (await cmd.retry()) {
    f.value.raw = '';
    emit('done');
    open.value = false;
  }
}
function capture(raw: string) {
  f.value.raw = raw;
  scannerProfile.value = 'camera-gs1-v1';
  camera.value = false;
}
async function loadCalendar(files: File | File[] | null) {
  const file = Array.isArray(files) ? files[0] : files;
  if (!file) return;
  if (file.size > 150000) {
    invalid.value = 'Файл слишком большой.';
    return;
  }
  bulk.value = await file.text();
}
</script>
<template>
  <v-dialog
    v-model="open"
    max-width="560"
    :persistent="cmd.busy.value || !!cmd.pending.value"
    ><v-card class="pa-5"
      ><h2 class="text-title-medium mb-3">
        {{ titles[action] ?? 'Складское действие' }}
      </h2>
      <p class="text-body-small text-primary mb-4">Действие складского учёта</p>
      <CommandNotice
        :error="cmd.error.value"
        :message="cmd.message.value"
        :busy="cmd.busy.value"
        :uncertain="!!cmd.pending.value"
        @retry="retry"
      /><v-alert v-if="invalid" type="error" class="mb-3">{{
        invalid
      }}</v-alert>
      <form @submit.prevent="submit">
        <fieldset
          :disabled="cmd.busy.value || !!cmd.pending.value"
          class="marking-fieldset"
        >
          <template v-if="action === 'return'"
            ><v-text-field
              v-model="f.raw"
              label="Код возвращённой вещи"
              autocomplete="off"
              :spellcheck="false"
              class="mb-3"
              :single-line="false"
              @update:model-value="scannerProfile = 'keyboard-gs1-v1'" /><v-btn
              class="mb-3"
              @click="camera = true"
              >Сканировать камерой</v-btn
            ><v-select
              :model-value="f.kind ?? ''"
              label="Вид возврата"
              :items="[
                { title: 'Возврат покупателя', value: 'CUSTOMER' },
                { title: 'Невыкуп', value: 'UNCLAIMED' },
              ]"
              class="mb-3"
              :single-line="false"
              @update:model-value="f.kind = $event ?? ''" /><v-select
              :model-value="f.condition ?? ''"
              label="Состояние вещи"
              :items="[
                { title: 'Всё в порядке', value: 'GOOD' },
                { title: 'Брак', value: 'DEFECTIVE' },
                { title: 'Повреждена маркировка', value: 'DAMAGED_CODE' },
                { title: 'Другая вещь', value: 'WRONG_ITEM' },
              ]"
              class="mb-3"
              :single-line="false"
              @update:model-value="f.condition = $event ?? ''" />
            <p class="text-body-small text-secondary mb-3">
              Если скан невозможен — нужна помощь владельца. Восстановление кода
              здесь недоступно.
            </p>
            <v-select
              :model-value="f.paid ?? ''"
              label="Подтверждённый факт оплаты"
              :items="[
                { title: 'Оплата подтверждена', value: 'true' },
                { title: 'Оплаты не было', value: 'false' },
              ]"
              class="mb-3"
              :single-line="false"
              @update:model-value="f.paid = $event ?? ''"
          /></template>
          <v-select
            v-if="action === 'dispose'"
            :model-value="f.reason ?? ''"
            label="Основание"
            :items="[
              { title: 'Утрата', value: 'LOSS' },
              { title: 'Уничтожение', value: 'DESTRUCTION' },
            ]"
            class="mb-3"
            :single-line="false"
            @update:model-value="f.reason = $event ?? ''"
          />
          <v-text-field
            v-for="[key, label] in fields"
            :key="key"
            v-model="f[key!]"
            :label="label"
            :type="key === 'documentDate' ? 'date' : 'text'"
            class="mb-3"
            :single-line="false"
          />
          <template v-if="action === 'calendar'"
            ><p class="text-body-small text-secondary mb-3">
              Один пакет до 800 дат: [{"date":"2026-11-04","working":false}].
              Выходные не определяются автоматически.
            </p>
            <v-file-input
              label="Файл календаря JSON"
              accept=".json,application/json"
              @update:model-value="loadCalendar" /><v-textarea
              v-model="bulk"
              label="Даты календаря JSON"
              :single-line="false"
          /></template>
          <v-textarea
            v-if="action === 'supply'"
            v-model="bulk"
            label="Идентификаторы экземпляров · по одному в строке"
            :single-line="false"
          />
          <template v-if="hasDocument"
            ><p class="text-body-small text-secondary mb-3">
              Реквизиты первичного документа
            </p>
            <v-text-field
              v-model="f.number"
              label="Номер документа"
              class="mb-3"
              :single-line="false" /><v-text-field
              v-model="f.date"
              type="date"
              label="Дата документа"
              class="mb-3"
              :single-line="false" /><v-text-field
              v-model="f.name"
              label="Название документа"
              class="mb-3"
              :single-line="false"
          /></template>
          <v-checkbox
            v-if="action === 'handover'"
            v-model="outside"
            label="Уже передано вне приложения"
          />
          <v-text-field
            v-if="
              action === 'return' ||
              action === 'dispose' ||
              (action === 'handover' && outside)
            "
            v-model="f.occurredAt"
            type="datetime-local"
            label="Фактическая дата и время"
            :single-line="false"
          />
          <p
            v-if="action === 'handover' && !outside"
            class="text-body-small text-secondary"
          >
            Фактическое время будет записано при подтверждении. Нужен настоящий
            номер или ссылка подтверждения.
          </p>
          <v-checkbox
            v-if="['handover', 'return', 'cancel', 'dispose'].includes(action)"
            v-model="checked"
            :label="
              action === 'cancel'
                ? 'Все вещи посылки физически у меня'
                : action === 'dispose'
                  ? 'Подтверждаю факт и необратимость списания'
                  : 'Подтверждаю фактическое событие'
            "
          />
          <v-btn type="submit" block color="primary-strong" class="mt-4">{{
            action === 'dispose' ? 'Подтвердить списание' : 'Подтвердить'
          }}</v-btn>
        </fieldset>
      </form>
      <v-btn
        class="mt-3"
        variant="text"
        :disabled="cmd.busy.value || !!cmd.pending.value"
        color="secondary"
        @click="open = false"
        >Закрыть</v-btn
      ></v-card
    ></v-dialog
  ><CameraScanner v-model="camera" @scan="capture" />
</template>
<style scoped>
.marking-fieldset {
  border: 0;
  min-width: 0;
  padding: 0;
}
</style>
