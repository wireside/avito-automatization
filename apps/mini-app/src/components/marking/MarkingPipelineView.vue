<script setup lang="ts">
import IntegrationStatusBanner from './IntegrationStatusBanner.vue';
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import {
  shipmentsSchema,
  issuesSchema,
  overviewSchema,
} from '@avito/contracts';
import {
  createMarkingApi,
  markingLabel,
  displayDate,
  displayMoney,
} from '../../marking-api';
import ShipmentWorkspace from './ShipmentWorkspace.vue';
import MarkingSettingsView from './MarkingSettingsView.vue';
import MarkingDocumentPanel from './MarkingDocumentPanel.vue';
import MarkingActionDialog from './MarkingActionDialog.vue';
import CommandNotice from './CommandNotice.vue';
import { useMarkingCommand } from '../../composables/useMarkingCommand';
const props = defineProps<{
  initData: string;
  roles: string[];
  active: boolean;
  view: string;
}>();
const emit = defineEmits<{ navigate: [view: string] }>();
const api = createMarkingApi(props.initData);
const issueCommand = useMarkingCommand(props.initData);
const locked = ref(false);
function openShipment(id: unknown) {
  if (typeof id !== 'string' || !/[0-9a-f-]{36}/i.test(id) || locked.value)
    return;
  selected.value = id;
  emit('navigate', 'packing');
}
const selected = ref('');
const offset = ref(0);
const issueOffset = ref(0);
const search = ref('');
const docId = ref('');
const docOpen = ref(false);
const retryId = ref('');
const retryOpen = ref(false);
const queue = useQuery({
  queryKey: computed(() => ['marking', 'shipments', offset.value]),
  queryFn: ({ signal }) =>
    api.read(`shipments?offset=${offset.value}`, shipmentsSchema, signal),
  enabled: computed(
    () => props.active && props.view === 'packing' && !selected.value,
  ),
  refetchInterval: computed(() =>
    props.active && props.view === 'packing' && !selected.value ? 15000 : false,
  ),
});
const issues = useQuery({
  queryKey: computed(() => ['marking', 'issues', issueOffset.value]),
  queryFn: ({ signal }) =>
    api.read(`issues?offset=${issueOffset.value}`, issuesSchema, signal),
  enabled: computed(() => props.active && props.view === 'issues'),
  refetchInterval: computed(() =>
    props.active && props.view === 'issues' ? 15000 : false,
  ),
});
const overview = useQuery({
  queryKey: ['marking', 'overview'],
  queryFn: ({ signal }) => api.read('overview', overviewSchema, signal),
  enabled: computed(() => props.active),
  refetchInterval: computed(() => (props.active ? 15000 : false)),
});
const items = computed(() =>
  (queue.data.value?.data ?? []).filter(
    (s) =>
      !search.value ||
      `${s.parcel_code} ${s.external_order_id ?? ''}`
        .toLocaleLowerCase('ru-RU')
        .includes(search.value.toLocaleLowerCase('ru-RU')),
  ),
);
const owner = computed(() =>
  props.roles.some((r) => ['OWNER', 'ADMIN'].includes(r)),
);
function detailString(value: unknown) {
  return typeof value === 'string' ? value : '';
}
function showDocument(value: unknown) {
  const id = detailString(value);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  docId.value = id;
  docOpen.value = true;
}
</script>
<template>
  <IntegrationStatusBanner
    v-if="active && view !== 'settings'"
    :init-data="initData"
  />
  <div>
    <ShipmentWorkspace
      v-if="selected"
      v-show="view === 'packing'"
      :id="selected"
      :init-data="initData"
      :roles="roles"
      :active="active && view === 'packing'"
      @back="selected = ''"
      @locked="locked = $event"
    /><template v-if="view === 'packing' && !selected"
      ><div class="d-flex align-start ga-3 mb-4">
        <div>
          <h1 class="text-title-large">Очередь упаковки</h1>
          <p class="text-body-small text-secondary mt-2">
            Заказы Авито, взятые в работу
          </p>
        </div>
        <v-spacer /><v-btn
          :loading="queue.isFetching.value"
          @click="queue.refetch()"
          >Обновить</v-btn
        >
      </div>
      <v-sheet
        v-if="overview.data.value"
        class="d-flex flex-wrap ga-4 mb-5 text-body-small text-secondary"
        ><span>Упаковано: {{ overview.data.value.data.packed }}</span
        ><span>Готово: {{ overview.data.value.data.ready }}</span
        ><span>Проблем: {{ overview.data.value.data.issues }}</span></v-sheet
      ><v-progress-linear v-if="queue.isPending.value" indeterminate /><v-alert
        v-if="queue.isError.value"
        type="error"
        class="mb-4"
        >{{ queue.error.value?.message }}
        <p v-if="queue.data.value">Показаны устаревшие данные.</p>
        <v-btn @click="queue.refetch()">Повторить</v-btn></v-alert
      ><v-text-field
        v-model="search"
        label="Поиск по текущей странице"
        class="mb-5"
        :single-line="false"
      /><v-row
        ><v-col v-for="item in items" :key="item.id" cols="12" md="6"
          ><v-card
            tag="button"
            type="button"
            class="pa-5 text-left w-100"
            :aria-label="`Открыть посылку ${item.parcel_code}`"
            @click="selected = item.id"
            ><div class="d-flex flex-wrap ga-2 align-center">
              <h2 class="text-title-medium">{{ item.parcel_code }}</h2>
              <v-spacer /><v-chip color="primary-soft" class="text-primary"
                >Складской заказ</v-chip
              >
            </div>
            <p class="text-body-medium mt-3">{{ markingLabel(item.status) }}</p>
            <p
              v-if="item.external_order_id"
              class="text-body-small text-secondary mt-2 text-break"
            >
              Заказ {{ item.external_order_id }}
            </p>
            <p class="text-body-small text-muted mt-2">
              {{ displayDate(item.created_at) }}
              <span v-if="item.items_count !== undefined">
                · {{ item.items_count }} вещей</span
              >
              <span v-if="item.sale_total_kopecks != null">
                · {{ displayMoney(item.sale_total_kopecks) }}</span
              >
            </p></v-card
          ></v-col
        ></v-row
      ><v-card v-if="queue.isSuccess.value && !items.length" class="pa-5 mt-4"
        ><p>
          {{
            search
              ? 'На странице ничего не найдено.'
              : 'Нет отгрузок для упаковки.'
          }}
        </p>
        <p class="text-body-small text-secondary mt-2">
          Откройте заказ Авито и возьмите его в работу. Состав и цена будут
          загружены из Авито.
        </p></v-card
      >
      <div class="d-flex justify-space-between mt-5">
        <v-btn
          :disabled="!offset || queue.isFetching.value"
          @click="offset -= 50"
          >Назад</v-btn
        ><v-btn
          :disabled="
            queue.data.value?.data.length !== 50 || queue.isFetching.value
          "
          @click="offset += 50"
          >Следующая страница</v-btn
        >
      </div></template
    >
    <section v-if="view === 'issues'">
      <h1 class="text-title-large mb-5">Проблемы и исключения</h1>
      <CommandNotice
        :error="issueCommand.error.value"
        :message="issueCommand.message.value"
        :busy="issueCommand.busy.value"
        :uncertain="!!issueCommand.pending.value"
        @retry="issueCommand.retry()"
      />
      <v-progress-linear v-if="issues.isPending.value" indeterminate /><v-alert
        v-if="issues.isError.value"
        type="error"
        class="mb-4"
        >Не удалось обновить проблемы.<span v-if="issues.data.value">
          Показаны прошлые данные.</span
        ><v-btn @click="issues.refetch()">Повторить</v-btn></v-alert
      ><v-card
        v-for="issue in issues.data.value?.data"
        :key="issue.id"
        class="pa-5 mb-4"
        ><h2 class="text-title-medium">{{ markingLabel(issue.code) }}</h2>
        <p class="text-body-small text-secondary mt-2">
          {{ displayDate(issue.created_at) }}
        </p>
        <p v-if="issue.details.dueAt" class="text-body-small text-warning mt-3">
          Срок: {{ displayDate(detailString(issue.details.dueAt)) }}
        </p>
        <p class="text-body-medium text-secondary mt-3">
          {{
            ['LEGAL_DEADLINE_EXCEEDED', 'HANDOVER_OUTSIDE_APP'].includes(
              issue.code,
            )
              ? 'Срочно обратитесь к владельцу.'
              : 'Проверьте исходные данные и связанный документ. Автоматически закрыть проблему нельзя.'
          }}
        </p>
        <div class="d-flex flex-wrap ga-2 mt-4">
          <v-btn
            v-if="
              issue.details.shipmentId ||
              ['PREPARED_NOT_HANDED_OVER', 'HANDOVER_OUTSIDE_APP'].includes(
                issue.code,
              )
            "
            :disabled="locked"
            @click="openShipment(issue.details.shipmentId ?? issue.entity_id)"
            >Открыть посылку</v-btn
          >
          <v-btn
            v-if="
              issue.code === 'LEGAL_CHECK_STALE' &&
              roles.some((r) => ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(r)) &&
              true
            "
            :disabled="issueCommand.busy.value || !!issueCommand.pending.value"
            @click="issueCommand.send('check', { unitId: issue.entity_id })"
            >Обновить проверку</v-btn
          >
          <v-btn
            v-if="!issue.details.documentId"
            @click="
              docId = '';
              docOpen = true;
            "
            >Документы</v-btn
          >
          <v-btn
            v-if="issue.details.documentId"
            @click="showDocument(issue.details.documentId)"
            >Открыть документ</v-btn
          ><v-btn
            v-if="owner && issue.code === 'JOB_FAILED'"
            @click="
              retryId = issue.entity_id;
              retryOpen = true;
            "
            >Повторить после проверки</v-btn
          >
        </div>
        <v-expansion-panels class="mt-3" variant="accordion"
          ><v-expansion-panel title="Технические детали"
            ><v-expansion-panel-text
              ><p class="text-body-small text-break">
                Объект: {{ issue.entity_id }}
              </p>
              <p class="text-body-small">
                Код: {{ issue.code }}
              </p></v-expansion-panel-text
            ></v-expansion-panel
          ></v-expansion-panels
        ></v-card
      >
      <p
        v-if="issues.isSuccess.value && !issues.data.value?.data.length"
        class="text-body-medium py-5"
      >
        Нерешённых проблем нет.
      </p>
      <div class="d-flex justify-space-between mt-5">
        <v-btn
          :disabled="!issueOffset || issues.isFetching.value"
          @click="issueOffset -= 50"
          >Назад</v-btn
        ><v-btn
          :disabled="
            issues.data.value?.data.length !== 50 || issues.isFetching.value
          "
          @click="issueOffset += 50"
          >Следующая страница</v-btn
        >
      </div>
    </section>
    <MarkingSettingsView
      v-if="view === 'settings' && owner"
      :roles="roles"
      :init-data="initData"
      :active="active"
    /><v-dialog v-model="docOpen" max-width="880"
      ><v-card class="pa-5"
        ><MarkingDocumentPanel
          :init-data="initData"
          :roles="roles"
          :document-id="docId"
          :active="docOpen && active"
        /><v-btn @click="docOpen = false">Закрыть</v-btn></v-card
      ></v-dialog
    ><MarkingActionDialog
      v-model="retryOpen"
      action="retry"
      :entity-id="retryId"
      :init-data="initData"
    />
  </div>
</template>
