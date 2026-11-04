<script setup lang="ts">
defineProps<{ simulated: boolean; mode: string }>();
</script>
<template>
  <v-alert
    :color="mode === 'disabled' ? 'secondary' : 'primary'"
    class="mb-5 text-body-small"
    ><strong>{{
      mode === 'disabled'
        ? 'Тестовый процесс выключен'
        : simulated
          ? 'Тестовый процесс'
          : 'Данные складского учёта'
    }}</strong>
    <p class="mt-1">
      {{
        simulated
          ? 'Симуляция. Без реальных изменений Авито и ЧЗ; не является юридическим подтверждением.'
          : 'Физическая приёмка не подтверждает юридическую готовность товара.'
      }}
    </p></v-alert
  >
</template>
