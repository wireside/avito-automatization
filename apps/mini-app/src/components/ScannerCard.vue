<script setup lang="ts">
import { nextTick, ref, type ComponentPublicInstance } from 'vue';
import { useDisplay } from 'vuetify';
import DesignIcon from './DesignIcon.vue';
const raw = defineModel<string>({ required: true });
defineProps<{ disabled: boolean; cameraOpen: boolean }>();
const emit = defineEmits<{
  submit: [];
  camera: [];
  phone: [];
  keydown: [event: KeyboardEvent];
  paste: [event: ClipboardEvent];
}>();
const { mdAndUp } = useDisplay();
const field = ref<ComponentPublicInstance>();
function focus() {
  void nextTick(() => {
    const input = field.value?.$el.querySelector('input') as
      HTMLInputElement | undefined;
    input?.focus({ preventScroll: true });
  });
}
defineExpose({ focus });
</script>
<template>
  <v-card
    :border="!mdAndUp"
    class="pa-4 pa-md-5"
    aria-labelledby="intake-title"
  >
    <h2 id="intake-title" class="text-title-medium d-flex align-center ga-2">
      <DesignIcon :name="mdAndUp ? 'scanDesktop' : 'scan'" />Добавить товар
    </h2>
    <p class="text-body-small text-secondary mt-3 mb-4">
      Сканируйте код «Честного знака»
    </p>
    <form @submit.prevent="emit('submit')">
      <div class="d-flex ga-3 align-start">
        <v-text-field
          id="scan-input"
          ref="field"
          v-model="raw"
          class="flex-grow-1 min-w-0"
          aria-label="USB-сканер или строка DataMatrix"
          placeholder="Код маркировки"
          autocomplete="off"
          autocapitalize="off"
          :spellcheck="false"
          :disabled="disabled"
          @keydown="emit('keydown', $event)"
          @paste="emit('paste', $event)"
        >
          <template #prepend-inner><DesignIcon name="scanField" /></template>
        </v-text-field>
        <v-btn
          icon
          color="primary-soft"
          rounded="md"
          size="48"
          :disabled="disabled || cameraOpen"
          aria-label="Сканировать камерой"
          title="Сканировать камерой этого устройства"
          @click="emit('camera')"
          ><DesignIcon name="camera"
        /></v-btn>
      </div>
      <p class="text-label-small text-secondary d-flex align-center ga-2 mt-3">
        <DesignIcon name="usb" />USB-сканер · добавление по Enter или Tab
      </p>
      <v-btn
        v-if="raw && !disabled"
        type="submit"
        block
        color="primary-strong"
        class="mt-3"
        >Добавить со сканера</v-btn
      >
    </form>
    <v-btn
      v-if="mdAndUp"
      block
      color="primary-soft"
      class="text-primary mt-4"
      @click="emit('phone')"
      ><DesignIcon name="phone" class="mr-2" />Сканировать телефоном</v-btn
    >
    <p v-if="mdAndUp" class="text-body-small text-muted mt-4">
      Один скан — одна вещь. Подтверждение появится после сохранения на складе.
    </p>
  </v-card>
</template>
