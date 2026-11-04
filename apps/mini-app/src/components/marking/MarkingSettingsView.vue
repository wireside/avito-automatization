<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import {
  settingsSchema,
  overviewSchema,
  type MarkingAction,
} from '@avito/contracts';
import { createMarkingApi } from '../../marking-api';
import MarkingActionDialog from './MarkingActionDialog.vue';
import SimulationBanner from './SimulationBanner.vue';
const props = defineProps<{ initData: string; active: boolean }>();
const api = createMarkingApi(props.initData);
const settings = useQuery({
  queryKey: ['marking', 'settings'],
  queryFn: ({ signal }) => api.read('settings', settingsSchema, signal),
  enabled: computed(() => props.active),
});
const overview = useQuery({
  queryKey: ['marking', 'overview'],
  queryFn: ({ signal }) => api.read('overview', overviewSchema, signal),
  enabled: computed(() => props.active),
});
const dialog = ref(false);
const action = ref<MarkingAction>('configure');
const defaults = ref<Record<string, string>>({});
function open(value: MarkingAction, row?: Record<string, string>) {
  action.value = value;
  defaults.value = row
    ? {
        warehouseId: row.warehouse_id!,
        sellerInn: row.seller_inn!,
        fiasId: row.fias_id!,
        address: row.address!,
        fiscalEvidenceReference: row.fiscal_evidence_reference!,
      }
    : {};
  dialog.value = true;
}
</script>
<template>
  <section>
    <h1 class="text-title-large mb-5">Настройки владельца</h1>
    <SimulationBanner
      v-if="settings.data.value"
      :mode="settings.data.value.mode"
      :simulated="settings.data.value.simulated"
    /><v-alert v-if="settings.isError.value" type="error" class="mb-4"
      >Не удалось загрузить настройки.<v-btn @click="settings.refetch()"
        >Повторить</v-btn
      ></v-alert
    ><v-progress-linear v-if="settings.isPending.value" indeterminate /><v-row
      ><v-col cols="12" md="7"
        ><v-card class="pa-5 mb-4"
          ><h2 class="text-title-medium mb-4">Реквизиты ИП и склада</h2>
          <p
            v-if="settings.data.value && !settings.data.value.data.length"
            class="text-body-medium text-secondary"
          >
            Реквизиты ещё не заполнены.
          </p>
          <v-sheet
            v-for="row in settings.data.value?.data"
            :key="row.warehouse_id"
            class="mb-4"
            ><p>ИНН ИП: {{ row.seller_inn }}</p>
            <p class="text-body-small text-secondary mt-2">{{ row.address }}</p>
            <p class="text-body-small text-muted mt-2 text-break">
              ФИАС: {{ row.fias_id }}
            </p>
            <v-btn
              v-if="settings.data.value?.mode === 'simulation'"
              class="mt-3"
              @click="open('configure', row)"
              >Изменить реквизиты</v-btn
            ></v-sheet
          ><v-btn
            v-if="settings.data.value?.mode === 'simulation'"
            @click="open('configure')"
            >Добавить реквизиты склада</v-btn
          ></v-card
        ><v-card class="pa-5"
          ><h2 class="text-title-medium mb-4">Документы поставщика</h2>
          <p class="text-body-medium text-secondary mb-4">
            Подтверждение передаётся одной пачкой для экземпляров. В этом режиме
            это тестовые факты, а не подписание УПД. Закупочная стоимость не
            требуется.
          </p>
          <v-btn
            v-if="settings.data.value?.mode === 'simulation'"
            @click="open('supply')"
            >Импортировать сведения</v-btn
          ></v-card
        ></v-col
      ><v-col cols="12" md="5"
        ><v-card class="pa-5 mb-4"
          ><h2 class="text-title-medium mb-4">Рабочий календарь</h2>
          <p v-if="overview.isError.value" class="text-body-small text-warning">
            Не удалось получить состояние календаря.
          </p>
          <p v-else-if="overview.data.value" class="text-body-medium">
            {{
              overview.data.value.data.calendar_days
                ? `Загружено дат: ${overview.data.value.data.calendar_days}`
                : 'Календарь не загружен'
            }}
          </p>
          <v-btn
            v-if="settings.data.value?.mode === 'simulation'"
            class="mt-4"
            @click="open('calendar')"
            >Загрузить пакет дат</v-btn
          ></v-card
        ><v-card class="pa-5"
          ><h2 class="text-title-medium mb-4">Локальный подписант</h2>
          <v-chip color="raised" class="text-secondary"
            >Состояние подключения неизвестно</v-chip
          >
          <p class="text-body-medium text-secondary mt-4">
            API пока не сообщает, находится ли агент в сети. Статус задания
            подписи доступен в карточке документа.
          </p>
          <p class="text-body-small text-muted mt-3">
            Реальная криптографическая проверка ещё не подключена. Ключ УКЭП,
            сертификат и PIN здесь не запрашиваются. Тестовая подпись не
            является УКЭП.
          </p></v-card
        ></v-col
      ></v-row
    ><MarkingActionDialog
      v-model="dialog"
      :action="action"
      :init-data="initData"
      :defaults="defaults"
      @done="settings.refetch()"
    />
  </section>
</template>
