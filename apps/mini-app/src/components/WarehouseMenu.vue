<script setup lang="ts">
import { computed, ref } from 'vue';
import { mdiChevronDown } from '@mdi/js';
import type { WarehouseSummaryDto } from '@avito/contracts';
import { useWarehouses } from '../composables/useWarehouses';
import WarehouseDialog from './WarehouseDialog.vue';
const props = defineProps<{
  initData: string;
  roles: string[];
  disabled?: boolean;
}>();
const { warehouses, selected, select } = useWarehouses(props.initData);
const manage = computed(() =>
  props.roles.some((r) => ['OWNER', 'ADMIN'].includes(r)),
);
const dialog = ref(false),
  editing = ref<WarehouseSummaryDto>();
function edit() {
  editing.value = selected.value;
  dialog.value = true;
}
function add() {
  editing.value = undefined;
  dialog.value = true;
}
</script>
<template>
  <div>
    <v-menu>
      <template #activator="{ props: menuProps }"
        ><v-btn
          v-bind="menuProps"
          variant="text"
          color="secondary"
          :append-icon="mdiChevronDown"
          :disabled="disabled"
          aria-label="Выбрать склад"
          ><span class="warehouse-name" :title="selected?.name">{{
            selected?.name ?? 'Основной склад'
          }}</span></v-btn
        ></template
      >
      <v-list aria-label="Склады" max-width="360">
        <v-list-item
          v-for="item in warehouses.data.value?.items"
          :key="item.id"
          :title="item.name"
          :subtitle="item.address ?? 'Адрес отгрузки не настроен'"
          :active="item.id === selected?.id"
          @click="select(item.id)"
        />
        <v-list-item
          v-if="warehouses.isError.value"
          title="Не удалось загрузить склады"
          @click="warehouses.refetch()"
        />
        <template v-if="manage"
          ><v-divider /><v-list-item
            v-if="selected"
            title="Настроить выбранный склад"
            @click="edit" /><v-list-item title="Добавить склад" @click="add"
        /></template>
      </v-list>
    </v-menu>
    <WarehouseDialog
      v-if="manage"
      v-model="dialog"
      :init-data="initData"
      :warehouse="editing"
      @saved="select"
    />
  </div>
</template>

<style scoped>
.warehouse-name {
  max-width: min(46vw, 260px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
