<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { chzConnectionSchema } from '@avito/contracts';
import { createWarehouseApi } from '../../warehouse-api';
const props = defineProps<{ initData: string; active: boolean }>();
const api = createWarehouseApi(props.initData),
  client = useQueryClient();
const connection = useQuery({
  queryKey: ['chz-connection'],
  queryFn: ({ signal }) =>
    api('chz/connection', chzConnectionSchema, undefined, signal),
  enabled: computed(() => props.active),
  refetchInterval: computed(() => (props.active ? 5000 : false)),
  retry: false,
});
const inn = ref(''),
  busy = ref(false),
  error = ref('');
watch(
  () => connection.data.value?.sellerInn,
  (value) => {
    if (value) inn.value = value;
  },
  { immediate: true },
);
async function connect() {
  if (busy.value || !/^\d{12}$/.test(inn.value)) return;
  busy.value = true;
  error.value = '';
  try {
    const data = await api('chz/connection', chzConnectionSchema, {
      sellerInn: inn.value,
    });
    client.setQueryData(['chz-connection'], data);
    await client.invalidateQueries({ queryKey: ['marking', 'integrations'] });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось сохранить ИНН.';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <v-card class="pa-5 mb-4">
    <h2 class="text-title-medium mb-3">Подключение Честного знака</h2>
    <p class="text-body-medium text-secondary mb-4">
      Подключите ИП один раз. Затем можно загрузить адреса отгрузки и настроить
      склады.
    </p>
    <v-alert v-if="connection.isError.value" type="warning" class="mb-3"
      >Не удалось проверить подключение.<v-btn
        variant="text"
        color="primary"
        @click="connection.refetch()"
        >Повторить</v-btn
      ></v-alert
    >
    <v-text-field
      v-model="inn"
      label="ИНН ИП · 12 цифр"
      inputmode="numeric"
      maxlength="12"
      :readonly="
        !!connection.data.value?.sellerInn &&
        !connection.data.value.canChangeInn
      "
      :disabled="busy || connection.isPending.value || connection.isError.value"
    />
    <v-btn
      v-if="
        !connection.data.value?.sellerInn ||
        (connection.data.value.canChangeInn &&
          inn !== connection.data.value.sellerInn)
      "
      color="primary-strong"
      :loading="busy"
      :disabled="
        !/^\d{12}$/.test(inn) ||
        connection.isPending.value ||
        connection.isError.value
      "
      @click="connect"
      >Сохранить ИНН</v-btn
    >
    <v-alert v-if="error" type="warning" class="mt-3">{{ error }}</v-alert>
    <v-alert
      v-if="connection.data.value?.authorized"
      type="success"
      class="mt-3"
      >Честный знак подключён. Адреса отгрузки доступны при настройке
      склада.</v-alert
    >
    <p
      v-else-if="connection.data.value?.sellerInn"
      class="text-body-medium text-secondary mt-3"
    >
      {{
        connection.data.value.signerActive
          ? 'Ожидаем авторизацию ЧЗ. Включите компьютер с подписантом и подключите токен УКЭП.'
          : 'Подключите Windows-подписант ниже и подтвердите компьютер в Telegram. ИНН сертификата должен совпадать с ИНН ИП.'
      }}
      Статус обновится автоматически.
    </p>
  </v-card>
</template>
