<script setup lang="ts">
import { ref } from 'vue';
import type { WarehouseSummaryDto } from '@avito/contracts';
import { useWarehouses } from '../composables/useWarehouses';
import WarehouseDialog from './WarehouseDialog.vue';
const props = defineProps<{ initData: string }>();
const { warehouses } = useWarehouses(props.initData);
const dialog = ref(false),
  editing = ref<WarehouseSummaryDto>();
function edit(warehouse?: WarehouseSummaryDto) {
  editing.value = warehouse;
  dialog.value = true;
}
</script>
<template>
  <v-card class="pa-5 mb-4">
    <h2 class="text-title-medium mb-3">Склады и адреса отгрузки</h2>
    <v-progress-linear v-if="warehouses.isPending.value" indeterminate />
    <v-alert v-if="warehouses.isError.value" type="warning"
      >Не удалось загрузить склады.<v-btn
        variant="text"
        color="primary"
        @click="warehouses.refetch()"
        >Повторить</v-btn
      ></v-alert
    >
    <v-sheet
      v-for="warehouse in warehouses.data.value?.items"
      :key="warehouse.id"
      class="mb-4"
    >
      <p class="text-title-small">
        {{ warehouse.name
        }}<span
          v-if="warehouse.isDefault"
          class="text-body-small text-secondary"
        >
          · По умолчанию</span
        >
      </p>
      <p class="text-body-small text-secondary mt-2">
        {{ warehouse.address ?? 'Выберите адрес отгрузки из Честного знака' }}
      </p>
      <v-btn
        variant="outlined"
        color="primary"
        class="mt-3"
        @click="edit(warehouse)"
        >{{
          warehouse.configured ? 'Изменить склад' : 'Настроить адрес'
        }}</v-btn
      >
    </v-sheet>
    <v-btn
      :disabled="warehouses.isPending.value || warehouses.isError.value"
      @click="edit()"
      >Добавить склад</v-btn
    >
    <WarehouseDialog
      v-model="dialog"
      :init-data="initData"
      :warehouse="editing"
    />
  </v-card>
</template>
