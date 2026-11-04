<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { unitLegalSchema } from '@avito/contracts';
import { createMarkingApi, markingLabel, displayDate } from '../../marking-api';
import { useMarkingCommand } from '../../composables/useMarkingCommand';
import CommandNotice from './CommandNotice.vue';
import MarkingActionDialog from './MarkingActionDialog.vue';
const props = defineProps<{
  unitId: string;
  initData: string;
  roles: string[];
}>();
const expanded = ref(false);
const api = createMarkingApi(props.initData);
const cmd = useMarkingCommand(props.initData);
const dispose = ref(false);
const state = useQuery({
  queryKey: computed(() => ['marking', 'unit', props.unitId]),
  queryFn: ({ signal }) =>
    api.read(`units/${props.unitId}`, unitLegalSchema, signal),
  enabled: expanded,
  refetchInterval: computed(() => (expanded.value ? 15000 : false)),
});
const canCheck = computed(() =>
  props.roles.some((r) => ['OWNER', 'ADMIN', 'WAREHOUSE'].includes(r)),
);
const owner = computed(() =>
  props.roles.some((r) => ['OWNER', 'ADMIN'].includes(r)),
);
</script>
<template>
  <v-btn
    variant="text"
    color="primary"
    class="mt-2 px-0"
    :aria-expanded="expanded"
    @click="expanded = !expanded"
    >Юридическое состояние {{ expanded ? '↑' : '↓' }}</v-btn
  >
  <div v-if="expanded" class="mt-3">
    <v-progress-linear v-if="state.isPending.value" indeterminate /><v-alert
      v-if="state.isError.value"
      type="error"
      >Не удалось получить юридические данные.<v-btn @click="state.refetch()"
        >Повторить</v-btn
      ></v-alert
    ><template v-if="state.data.value"
      ><p class="text-title-small">
        {{
          state.data.value.mode === 'disabled'
            ? 'Юридическая проверка не подключена'
            : !state.data.value.data.blockers.length
              ? state.data.value.simulated
                ? 'Готов в тестовом процессе'
                : 'Готов к продаже'
              : state.data.value.data.received_legally
                ? 'Нужна помощь'
                : 'Проверяем документы'
        }}
      </p>
      <p class="text-body-small mt-2">
        Физически: {{ markingLabel(state.data.value.data.current_state) }}
      </p>
      <p class="text-body-small mt-1">
        Юридически: {{ markingLabel(state.data.value.data.legal_state) }}
      </p>
      <p class="text-body-small text-muted mt-1">
        Проверка: {{ displayDate(state.data.value.data.observed_at) }}
      </p>
      <p class="text-body-small text-primary mt-2">
        {{
          state.data.value.simulated
            ? 'Источник: симуляция, не юридическое доказательство.'
            : 'Нет подтверждённого юридического источника.'
        }}
      </p>
      <p
        v-for="b in state.data.value.data.blockers"
        :key="b"
        class="text-body-small text-secondary mt-1"
      >
        {{ markingLabel(b) }}
      </p>
      <CommandNotice
        :error="cmd.error.value"
        :message="cmd.message.value"
        :busy="cmd.busy.value"
        :uncertain="!!cmd.pending.value"
        @retry="cmd.retry()"
      />
      <div
        v-if="state.data.value.mode === 'simulation'"
        class="d-flex flex-wrap ga-2 mt-3"
      >
        <v-btn
          v-if="canCheck"
          :disabled="cmd.busy.value || !!cmd.pending.value"
          @click="cmd.send('check', { unitId })"
          >Обновить проверку</v-btn
        ><v-btn
          v-if="owner"
          variant="text"
          color="secondary"
          @click="dispose = true"
          >Утрата / уничтожение</v-btn
        >
      </div></template
    >
  </div>
  <MarkingActionDialog
    v-model="dispose"
    action="dispose"
    :entity-id="unitId"
    :init-data="initData"
  />
</template>
