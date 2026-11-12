<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { integrationStatusSchema } from '@avito/contracts';
import { createMarkingApi, displayDate } from '../../marking-api';
const props = defineProps<{ initData: string }>();
const status = useQuery({
  queryKey: ['marking', 'integrations'],
  queryFn: ({ signal }) =>
    createMarkingApi(props.initData).read(
      'integrations',
      integrationStatusSchema,
      signal,
    ),
  refetchInterval: 15000,
});
const problems = computed(() => {
  const d = status.data.value?.data;
  if (!d) return [];
  return [
    !d.seller_configured ? 'Не подключён ИП к Честному знаку' : null,
    !d.avitoConfigured ? 'Не настроен доступ к Авито' : null,
    !d.signerConfigured
      ? 'Не настроен сертификат локального подписанта'
      : !d.signer_online
        ? 'Подписант не подключён — включите Windows-компьютер с токеном'
        : null,
    !d.chz_authorized ? 'Ожидаем авторизацию в Честном знаке' : null,
    !d.documentsEnabled ? 'Отправка юридических документов выключена' : null,
    !d.avitoWritesEnabled ? 'Изменения заказов Авито выключены' : null,
  ].filter((v): v is string => !!v);
});
</script>
<template>
  <v-alert v-if="status.isError.value" type="warning" class="mb-5"
    >Не удалось получить состояние интеграций.
    <v-btn variant="text" @click="status.refetch()">Повторить</v-btn></v-alert
  >
  <v-progress-linear
    v-else-if="status.isPending.value"
    indeterminate
    class="mb-5"
  />
  <v-sheet
    v-else
    rounded="md"
    color="raised"
    class="pa-4 mb-5"
    aria-label="Состояние интеграций"
  >
    <div class="d-flex flex-wrap ga-2 mb-2">
      <v-chip
        :color="
          status.data.value?.data.chz_authorized ? 'success' : 'secondary'
        "
        >ЧЗ:
        {{
          status.data.value?.data.chz_authorized
            ? 'подключён'
            : 'ожидаем подключения'
        }}</v-chip
      ><v-chip
        :color="status.data.value?.data.signer_online ? 'success' : 'secondary'"
        >Подписант:
        {{
          status.data.value?.data.signer_online ? 'в сети' : 'не в сети'
        }}</v-chip
      >
    </div>
    <p
      v-for="problem in problems"
      :key="problem"
      class="text-body-small text-secondary mt-1"
    >
      {{ problem }}
    </p>
    <p
      v-if="status.data.value?.data.signer_last_seen_at"
      class="text-label-small text-muted mt-2"
    >
      Подписант на связи:
      {{ displayDate(status.data.value.data.signer_last_seen_at) }}
    </p>
  </v-sheet>
</template>
