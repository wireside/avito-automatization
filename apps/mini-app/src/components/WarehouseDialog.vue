<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  chzConnectionSchema,
  chzPlacesSchema,
  warehouseSaveResponse,
  type WarehouseSummaryDto,
} from '@avito/contracts';
import { createWarehouseApi } from '../warehouse-api';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  initData: string;
  warehouse?: WarehouseSummaryDto | undefined;
}>();
const emit = defineEmits<{ saved: [id: string] }>();
const api = createWarehouseApi(props.initData),
  client = useQueryClient();
const name = ref(''),
  fiasId = ref(''),
  busy = ref(false),
  error = ref('');
const requestId = ref(crypto.randomUUID());
const help = ref<number[]>([]);
const connection = useQuery({
  queryKey: ['chz-connection'],
  queryFn: ({ signal }) =>
    api('chz/connection', chzConnectionSchema, undefined, signal),
  enabled: computed(() => open.value),
  refetchInterval: computed(() => (open.value ? 5000 : false)),
  retry: false,
});
const places = useQuery({
  queryKey: computed(() => ['chz-places', connection.data.value?.sellerInn]),
  queryFn: ({ signal }) =>
    api('chz/places', chzPlacesSchema, undefined, signal),
  enabled: computed(
    () => open.value && connection.data.value?.authorized === true,
  ),
  retry: false,
  staleTime: 0,
});
const items = computed(
  () =>
    places.data.value?.items.map((p) => ({
      title: p.address,
      value: p.fiasId,
    })) ?? [],
);
watch(open, (value) => {
  if (!value) return;
  name.value = props.warehouse?.name ?? '';
  fiasId.value = '';
  error.value = '';
  requestId.value = crypto.randomUUID();
});
watch([() => places.data.value, open], ([data, visible]) => {
  if (!visible || !data) return;
  help.value = data.items.length === 0 ? [0] : [];
  if (fiasId.value) return;
  const existing = data.items.filter(
    (p) => p.address === props.warehouse?.address,
  );
  if (existing.length === 1) fiasId.value = existing[0]!.fiasId;
  else if (data.items.length === 1) fiasId.value = data.items[0]!.fiasId;
});
watch([name, fiasId], () => {
  requestId.value = crypto.randomUUID();
  error.value = '';
});
async function save() {
  if (
    busy.value ||
    !name.value.trim() ||
    !items.value.some((p) => p.value === fiasId.value)
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    const result = await api('warehouses', warehouseSaveResponse, {
      requestId: requestId.value,
      name: name.value.trim(),
      fiasId: fiasId.value,
      ...(props.warehouse ? { warehouseId: props.warehouse.id } : {}),
    });
    await Promise.all([
      client.invalidateQueries({ queryKey: ['warehouses'] }),
      client.invalidateQueries({ queryKey: ['marking'] }),
      client.invalidateQueries({ queryKey: ['inventory'] }),
    ]);
    open.value = false;
    emit('saved', result.warehouseId);
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : 'Не удалось сохранить склад.';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <v-dialog
    v-model="open"
    max-width="620"
    :persistent="busy"
    aria-labelledby="warehouse-dialog-title"
  >
    <v-card class="pa-5">
      <h2 id="warehouse-dialog-title" class="text-title-medium mb-3">
        {{ warehouse ? 'Настройка склада' : 'Добавить склад' }}
      </h2>
      <p class="text-body-medium text-secondary mb-4">
        Выберите место отгрузки из Честного знака. Адрес и его реквизиты
        сохранятся автоматически.
      </p>
      <v-text-field
        v-model="name"
        label="Название склада"
        maxlength="200"
        :disabled="busy"
      />
      <v-alert v-if="connection.isError.value" type="warning" class="mb-3"
        >Не удалось проверить подключение ЧЗ.<v-btn
          variant="text"
          color="primary"
          @click="connection.refetch()"
          >Повторить</v-btn
        ></v-alert
      >
      <v-progress-linear v-else-if="connection.isPending.value" indeterminate />
      <v-alert
        v-else-if="!connection.data.value?.sellerInn"
        type="info"
        class="mb-3"
        >Сначала укажите ИНН в настройках подключения Честного знака и
        подключите Windows-подписант.</v-alert
      >
      <v-alert
        v-else-if="!connection.data.value.authorized"
        type="info"
        class="mb-3"
        >Ожидаем авторизацию ЧЗ. Включите Windows-компьютер с подписантом и
        подключите токен УКЭП. Адреса загрузятся автоматически.</v-alert
      >
      <template v-else>
        <v-progress-linear
          v-if="places.isFetching.value"
          indeterminate
          aria-label="Загружаем адреса ЧЗ"
          class="mb-3"
        />
        <v-alert v-if="places.isError.value" type="warning" class="mb-3"
          >{{ places.error.value?.message
          }}<v-btn variant="text" color="primary" @click="places.refetch()"
            >Повторить загрузку</v-btn
          ></v-alert
        >
        <template v-else-if="places.isSuccess.value">
          <v-select
            v-model="fiasId"
            :items="items"
            label="Адрес отгрузки"
            :disabled="busy || places.isFetching.value"
            no-data-text="В ЧЗ пока нет доступных адресов"
          />
          <p v-if="fiasId" class="text-body-medium text-break mb-3">
            {{
              places.data.value?.items.find((p) => p.fiasId === fiasId)?.address
            }}
          </p>
          <p
            v-if="items.length === 1"
            class="text-body-small text-secondary mb-3"
          >
            В ЧЗ найден один адрес. Проверьте его и подтвердите выбор.
          </p>
          <v-alert
            v-if="places.data.value?.incompleteCount"
            type="warning"
            class="mb-3"
            >Часть мест в ЧЗ не содержит адреса или его идентификатора.
            Дополните их в профиле ЧЗ и обновите список.</v-alert
          >
          <v-expansion-panels v-model="help" class="mb-4" multiple>
            <v-expansion-panel title="Нет нужного адреса?">
              <v-expansion-panel-text>
                Откройте личный кабинет ЧЗ → Профиль → МОД → Лёгкая
                промышленность → Добавить. Укажите ФИАС нужного места отгрузки;
                КПП для ИП не требуется. После добавления обновите список здесь.
                <div class="d-flex flex-wrap ga-2 mt-3">
                  <v-btn
                    href="https://markirovka.crpt.ru/login-kep"
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outlined"
                    color="primary"
                    >Открыть ЧЗ</v-btn
                  ><v-btn
                    variant="text"
                    color="primary"
                    :loading="places.isFetching.value"
                    @click="places.refetch()"
                    >Обновить адреса</v-btn
                  >
                </div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </template>
      </template>
      <v-alert v-if="error" type="warning" class="mb-3">{{ error }}</v-alert>
      <v-btn
        color="primary-strong"
        :loading="busy"
        :disabled="
          !name.trim() ||
          !fiasId ||
          !connection.data.value?.authorized ||
          places.isError.value ||
          places.isFetching.value
        "
        @click="save"
        >Подтвердить адрес</v-btn
      >
      <v-btn
        variant="text"
        color="primary"
        class="mt-2"
        :disabled="busy"
        @click="open = false"
        >Закрыть</v-btn
      >
    </v-card>
  </v-dialog>
</template>
