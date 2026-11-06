<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { documentsSchema, documentSchema } from '@avito/contracts';
import { createMarkingApi, markingLabel, displayDate } from '../../marking-api';
import MarkingActionDialog from './MarkingActionDialog.vue';
const props = defineProps<{
  initData: string;
  roles: string[];
  active: boolean;
  unitIds?: string[];
  documentId?: string;
}>();
const api = createMarkingApi(props.initData);
const offset = ref(0);
const selected = ref(props.documentId ?? '');
const correction = ref(false);
const exportError = ref('');
const exporting = ref(false);
const exportConfirm = ref(false);
watch(
  () => props.documentId,
  (id) => {
    selected.value = id ?? '';
  },
);
const docs = useQuery({
  queryKey: computed(() => ['marking', 'documents', offset.value]),
  queryFn: ({ signal }) =>
    api.read(`documents?offset=${offset.value}`, documentsSchema, signal),
  enabled: computed(() => props.active && !selected.value),
  refetchInterval: 15000,
});
const detail = useQuery({
  queryKey: computed(() => ['marking', 'document', selected.value]),
  queryFn: ({ signal }) =>
    api.read(`documents/${selected.value}`, documentSchema, signal),
  enabled: computed(() => props.active && !!selected.value),
  refetchInterval: 10000,
});
const current = computed(() => (selected.value ? detail : docs));
const shown = computed(() =>
  selected.value
    ? detail.data.value
      ? [detail.data.value.data]
      : []
    : (docs.data.value?.data ?? []).filter(
        (d) =>
          !props.unitIds ||
          d.items.some((i) =>
            props.unitIds!.includes(i.unitId ?? i.unit_id ?? ''),
          ),
      ),
);
const owner = computed(() =>
  props.roles.some((r) => ['OWNER', 'ADMIN'].includes(r)),
);
const canExport = computed(() =>
  props.roles.some((r) => ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(r)),
);
async function download() {
  exporting.value = true;
  exportError.value = '';
  try {
    await api.download(selected.value);
    exportConfirm.value = false;
  } catch {
    exportError.value = 'Не удалось скачать пакет. Повторите позже.';
  } finally {
    exporting.value = false;
  }
}
</script>
<template>
  <section>
    <div class="d-flex ga-3 align-center mb-4">
      <h2 class="text-title-medium">Документы ЧЗ</h2>
      <v-spacer /><v-btn
        v-if="selected"
        variant="text"
        color="secondary"
        @click="selected = ''"
        >К списку</v-btn
      ><v-btn :loading="current.isFetching.value" @click="current.refetch()"
        >Обновить</v-btn
      >
    </div>

    <p v-if="unitIds && !selected" class="text-body-small text-secondary mb-4">
      Документы этих экземпляров на текущей странице общего реестра. Полного
      серверного фильтра по заказу пока нет.
    </p>
    <v-progress-linear v-if="current.isPending.value" indeterminate /><v-alert
      v-if="current.isError.value"
      type="error"
      class="mb-3"
      >Не удалось обновить документы.<span v-if="current.data.value">
        Показаны прошлые данные.</span
      ><v-btn @click="current.refetch()">Повторить</v-btn></v-alert
    ><v-card v-for="doc in shown" :key="doc.id" class="pa-4 mb-4"
      ><div class="d-flex flex-wrap ga-2 align-center">
        <h3 class="text-title-small">{{ displayDate(doc.created_at) }}</h3>
        <v-chip color="primary-soft" class="text-primary">{{
          markingLabel(doc.status)
        }}</v-chip>
      </div>
      <p class="text-body-small text-secondary mt-3">
        Подпись: {{ markingLabel(doc.signing_status) }}
      </p>
      <p class="text-body-small text-muted mt-2">
        {{
          doc.signing_status === 'VERIFIED'
            ? 'Подпись проверена закреплённым подписантом.'
            : 'Ожидаем подпись владельца.'
        }}
        Результат обработки в ЧЗ показан отдельно.
      </p>
      <p
        v-if="doc.external_document_id"
        class="text-body-small mt-2 text-break"
      >
        Внешний номер: {{ doc.external_document_id }}
      </p>
      <v-sheet
        v-for="item in doc.items"
        :key="item.id"
        color="raised"
        rounded="md"
        class="pa-3 mt-3"
        ><p class="text-title-small">
          {{ item.maskedCode ?? item.masked_code }}
        </p>
        <p
          :class="
            item.status === 'CONFIRMED' ? 'text-success' : 'text-secondary'
          "
          class="text-body-small mt-1"
        >
          {{ markingLabel(item.status) }}
        </p>
        <p
          v-if="item.errorCode || item.error_code"
          class="text-body-small text-warning mt-1"
        >
          {{ markingLabel(item.errorCode ?? item.error_code) }}
        </p>
        <p
          v-if="item.dueAt || item.submission_due_at"
          class="text-body-small mt-1"
        >
          Срок: {{ displayDate(item.dueAt ?? item.submission_due_at) }}
        </p></v-sheet
      >
      <div class="d-flex flex-wrap ga-3 mt-4">
        <v-btn v-if="!selected" @click="selected = doc.id"
          >Открыть документ</v-btn
        ><v-btn v-if="selected && canExport" @click="exportConfirm = true"
          >Скачать документ</v-btn
        ><v-btn
          v-if="
            selected &&
            owner &&
            doc.status === 'MANUAL_ATTENTION' &&
            doc.items.some((i) => i.status === 'REJECTED')
          "
          @click="correction = true"
          >Исправить отклонённые строки</v-btn
        >
      </div></v-card
    >
    <p
      v-if="!current.isPending.value && !shown.length"
      class="text-body-medium text-secondary py-4"
    >
      Документов на этой странице нет.
    </p>
    <div v-if="!selected" class="d-flex justify-space-between ga-3 mt-4">
      <v-btn :disabled="!offset || docs.isFetching.value" @click="offset -= 50"
        >Назад</v-btn
      ><v-btn
        :disabled="docs.data.value?.data.length !== 50 || docs.isFetching.value"
        @click="offset += 50"
        >Следующая страница</v-btn
      >
    </div>
    <MarkingActionDialog
      v-model="correction"
      action="correctDocument"
      :entity-id="selected"
      :init-data="initData"
    /><v-dialog v-model="exportConfirm" max-width="480"
      ><v-card class="pa-5"
        ><h3 class="text-title-medium">Экспорт документа</h3>
        <p class="text-body-medium text-secondary my-4">
          JSON содержит полные коды внутри документа. Не публикуйте пакет.
          Документ и подпись экспортируются без изменения исходных байтов.
        </p>
        <v-alert v-if="exportError" type="error" class="mb-3">{{
          exportError
        }}</v-alert
        ><v-btn :loading="exporting" color="primary-strong" @click="download"
          >Скачать JSON</v-btn
        ><v-btn class="mt-3" @click="exportConfirm = false"
          >Закрыть</v-btn
        ></v-card
      ></v-dialog
    >
  </section>
</template>
