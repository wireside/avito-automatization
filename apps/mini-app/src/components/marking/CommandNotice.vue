<script setup lang="ts">
import type { MarkingApiError } from '../../marking-api';
import { markingLabel } from '../../marking-api';
defineProps<{
  error: MarkingApiError | undefined;
  message: string;
  busy: boolean;
  uncertain: boolean;
}>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div aria-live="polite">
    <v-progress-linear
      v-if="busy"
      indeterminate
      color="primary"
      class="mb-3"
    /><v-alert v-if="error" type="error" class="mb-4" role="alert"
      >{{ error.message }}
      <p v-for="b in error.blockers" :key="b" class="mt-1">
        {{ markingLabel(b) }}
      </p>
      <p v-if="error.requestId" class="text-body-small mt-2">
        Код обращения: {{ error.requestId }}
      </p>
      <template v-if="uncertain"
        ><p class="mt-2">
          Результат неизвестен. Повторим исходный запрос с тем же номером и
          данными.
        </p>
        <v-btn class="mt-3" :disabled="busy" @click="$emit('retry')"
          >Повторить исходный запрос</v-btn
        ></template
      ></v-alert
    ><v-alert v-else-if="message" color="success" class="mb-4">{{
      message
    }}</v-alert>
  </div>
</template>
