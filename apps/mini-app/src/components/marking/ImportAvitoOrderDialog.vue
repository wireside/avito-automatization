<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useQueryClient } from '@tanstack/vue-query';
import { useWarehouses } from '../../composables/useWarehouses';
import type { MarketplaceOrderDto } from '../../orders-api';
import type { StockVariant } from '../../inventory-api';
import { stockVariantLabel } from '../../stock-display';
import {
  createMarkingApi,
  markingLabel,
  MarkingApiError,
} from '../../marking-api';
import StockVariantPicker from './StockVariantPicker.vue';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{ initData: string; order: MarketplaceOrderDto }>();
const emit = defineEmits<{ done: [] }>();
const { warehouses, warehouseId, selected, select } = useWarehouses(
  props.initData,
);
const client = useQueryClient();
const busy = ref(false);
const error = ref('');
const selection = ref<Record<string, StockVariant>>({});
const pickingId = ref<string | null>(null);
const heading = ref<HTMLElement>();
let pickerTrigger: HTMLElement | null = null;
const pickedLine = computed(() =>
  props.order.items.find((line) => line.avitoId === pickingId.value),
);
const requestId = ref(crypto.randomUUID());

watch(open, (value) => {
  pickingId.value = null;
  pickerTrigger = null;
  if (value) {
    error.value = '';
    selection.value = {};
    requestId.value = crypto.randomUUID();
  }
});
watch(warehouseId, () => {
  selection.value = {};
  error.value = '';
  requestId.value = crypto.randomUUID();
});
function showPicker(itemId: string, event: MouseEvent) {
  pickerTrigger = event.currentTarget as HTMLElement;
  pickingId.value = itemId;
  void nextTick(() =>
    heading.value?.querySelector<HTMLElement>('input')?.focus(),
  );
}
function closePicker() {
  pickingId.value = null;
  void nextTick(() => pickerTrigger?.focus());
}
function setVariant(itemId: string, variant?: StockVariant) {
  if (variant?.id !== selection.value[itemId]?.id) {
    if (variant) selection.value[itemId] = variant;
    else delete selection.value[itemId];
    requestId.value = crypto.randomUUID();
    error.value = '';
  }
  if (pickingId.value) closePicker();
}
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await createMarkingApi(props.initData).command('importOrder', {
      requestId: requestId.value,
      externalOrderId: props.order.id,
      ...(warehouseId.value ? { warehouseId: warehouseId.value } : {}),
      mappings: Object.entries(selection.value).map(
        ([externalItemId, variant]) => ({
          externalItemId,
          variantId: variant.id,
        }),
      ),
    });
    await Promise.all([
      client.invalidateQueries({ queryKey: ['marking'] }),
      client.invalidateQueries({ queryKey: ['inventory'] }),
      client.invalidateQueries({ queryKey: ['inventory-units'] }),
    ]);
    open.value = false;
    emit('done');
  } catch (e) {
    error.value =
      e instanceof MarkingApiError
        ? markingLabel(e.code)
        : 'Не удалось начать сборку';
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
    :aria-labelledby="pickedLine ? 'collect-stock-title' : 'collect-title'"
  >
    <v-card rounded="xl" class="pa-4 pa-sm-5">
      <div v-show="!pickedLine">
        <h2 id="collect-title" class="text-title-medium">Собрать заказ</h2>
        <p class="text-body-small text-secondary mt-2">
          Выберите согласованный вариант. При начале сборки пары закрепятся за
          заказом.
        </p>
        <v-select
          class="mt-4"
          :model-value="warehouseId"
          :items="warehouses.data.value?.items ?? []"
          item-title="name"
          item-value="id"
          label="Склад отгрузки"
          :disabled="busy"
          @update:model-value="$event && select($event)"
        />
        <p
          v-if="selected && !selected.configured"
          class="text-body-small text-warning"
        >
          Сначала настройте адрес отгрузки этого склада в настройках.
        </p>
        <div v-for="item in order.items" :key="item.avitoId" class="mt-4">
          <h3 class="text-title-small text-break">
            {{ item.title }} · {{ item.quantity }} шт.
          </h3>
          <p
            v-if="selection[item.avitoId]"
            class="text-body-small text-secondary mt-1"
          >
            {{
              selection[item.avitoId]?.productName ??
              selection[item.avitoId]?.name
            }}
            ·
            {{ stockVariantLabel(selection[item.avitoId]!) }}
          </p>
          <p v-else class="text-body-small text-secondary mt-1">
            Если вариант уже привязан к объявлению, можно использовать его.
          </p>
          <div class="mt-2 d-flex ga-2 flex-wrap">
            <v-btn
              color="primary"
              variant="outlined"
              :disabled="busy"
              @click="showPicker(item.avitoId, $event)"
            >
              {{
                selection[item.avitoId]
                  ? 'Изменить позицию'
                  : 'Выбрать на складе'
              }}
            </v-btn>
            <v-btn
              v-if="selection[item.avitoId]"
              color="primary"
              variant="text"
              :disabled="busy"
              @click="setVariant(item.avitoId)"
              >Сбросить выбор</v-btn
            >
          </div>
        </div>
        <v-alert v-if="error" type="warning" class="mt-4" role="alert">{{
          error
        }}</v-alert>
        <div class="d-flex flex-column flex-sm-row-reverse ga-2 mt-5">
          <v-btn
            :loading="busy"
            :disabled="selected ? !selected.configured : false"
            color="primary-strong"
            variant="flat"
            class="flex-grow-1"
            @click="submit"
            >Начать сборку</v-btn
          >
          <v-btn
            color="primary"
            variant="outlined"
            class="flex-grow-1"
            :disabled="busy"
            @click="open = false"
            >Закрыть</v-btn
          >
        </div>
      </div>
      <div v-if="pickedLine" ref="heading">
        <StockVariantPicker
          :key="pickedLine.avitoId"
          :init-data="initData"
          :warehouse-id="warehouseId"
          :title="pickedLine.title"
          :quantity="pickedLine.quantity"
          :selected-id="selection[pickedLine.avitoId]?.id"
          @close="closePicker"
          @select="setVariant(pickedLine.avitoId, $event)"
        />
      </div>
    </v-card>
  </v-dialog>
</template>
