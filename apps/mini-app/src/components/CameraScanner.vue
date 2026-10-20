<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useDisplay } from 'vuetify';
import type { IScannerControls } from '@zxing/browser';
import DesignIcon from './DesignIcon.vue';
import reticle from '../assets/figma/camera-23029.svg';
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ scan: [raw: string] }>();
const { mdAndUp } = useDisplay();
const video = ref<HTMLVideoElement>();
const starting = ref(false);
const cameraError = ref('');
const torchAvailable = ref(false);
const torch = ref(false);
let controls: IScannerControls | undefined;
let generation = 0;
let disposed = false;
const track = () => {
  const stream = video.value?.srcObject;
  return typeof MediaStream !== 'undefined' && stream instanceof MediaStream
    ? stream.getVideoTracks()[0]
    : undefined;
};
function stop() {
  generation++;
  controls?.stop();
  controls = undefined;
  const stream = video.value?.srcObject;
  if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream)
    stream.getTracks().forEach((t) => t.stop());
  if (video.value) video.value.srcObject = null;
  starting.value = false;
  torch.value = false;
  torchAvailable.value = false;
}
function close() {
  stop();
  open.value = false;
}
async function start() {
  if (!open.value || disposed || starting.value || controls) return;
  cameraError.value = '';
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    cameraError.value =
      'Камера доступна по HTTPS. Откройте приложение из Telegram или используйте USB-сканер.';
    return;
  }
  starting.value = true;
  const currentGeneration = ++generation;
  await nextTick();
  try {
    const { BrowserDatamatrixCodeReader } = await import('@zxing/browser');
    if (currentGeneration !== generation || disposed || !video.value) return;
    const reader = new BrowserDatamatrixCodeReader(undefined, {
      delayBetweenScanAttempts: 150,
      delayBetweenScanSuccess: 1200,
    });
    const started = await reader.decodeFromConstraints(
      {
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      },
      video.value,
      (result, _error, active) => {
        if (!result || currentGeneration !== generation || disposed) return;
        active.stop();
        close();
        emit('scan', result.getText());
      },
    );
    if (currentGeneration !== generation || disposed) started.stop();
    else {
      controls = started;
      torchAvailable.value = Boolean(
        (
          track()?.getCapabilities() as
            (MediaTrackCapabilities & { torch?: boolean }) | undefined
        )?.torch,
      );
    }
  } catch {
    if (currentGeneration === generation) {
      stop();
      cameraError.value =
        'Не удалось открыть камеру. Разрешите доступ к ней в Telegram и настройках телефона или используйте сканер.';
    }
  } finally {
    if (currentGeneration === generation) starting.value = false;
  }
}
async function toggleTorch() {
  try {
    await track()?.applyConstraints({
      advanced: [{ torch: !torch.value } as MediaTrackConstraintSet],
    });
    torch.value = !torch.value;
  } catch {
    cameraError.value =
      'Не удалось включить фонарик. Попробуйте улучшить освещение.';
  }
}
const torchLabel = computed(() =>
  torch.value ? 'Выключить фонарик' : 'Включить фонарик',
);
function backgrounded() {
  if (document.hidden) close();
}
watch(open, (value) => {
  if (!value) stop();
});
document.addEventListener('visibilitychange', backgrounded);
onBeforeUnmount(() => {
  disposed = true;
  stop();
  document.removeEventListener('visibilitychange', backgrounded);
});
</script>
<template>
  <v-dialog
    v-model="open"
    :fullscreen="!mdAndUp"
    aria-labelledby="camera-title"
    @after-enter="start()"
  >
    <v-card color="background" class="pa-6 d-block overflow-y-auto">
      <div class="d-flex align-center justify-space-between ga-3 mb-5">
        <h2 id="camera-title" class="text-title-large">Сканирование</h2>
        <v-btn icon size="36" aria-label="Закрыть камеру" @click="close()"
          ><DesignIcon name="close"
        /></v-btn>
      </div>
      <p class="text-body-medium text-secondary mb-5">
        Наведите камеру на код «Честного знака»
      </p>
      <v-sheet
        color="raised"
        rounded="nav"
        class="camera-preview position-relative overflow-hidden"
      >
        <video
          ref="video"
          autoplay
          muted
          playsinline
          aria-label="Камера сканера"
        />
        <div class="camera-reticle">
          <img
            :src="reticle"
            width="242"
            height="264"
            alt=""
            aria-hidden="true"
          />
        </div>
        <v-overlay
          :model-value="starting"
          contained
          persistent
          class="align-center justify-center"
          ><v-progress-circular
            indeterminate
            color="primary"
            aria-label="Открываем камеру"
        /></v-overlay>
      </v-sheet>
      <v-alert v-if="cameraError" type="error" class="mt-4" role="alert"
        >{{ cameraError
        }}<v-btn
          v-if="!controls"
          block
          variant="text"
          class="mt-2"
          @click="start()"
          >Повторить запуск</v-btn
        ></v-alert
      >
      <div class="d-flex justify-center align-center ga-3 my-5">
        <v-btn
          icon
          size="48"
          :disabled="!torchAvailable"
          :aria-label="torchLabel"
          :aria-pressed="torch"
          @click="toggleTorch()"
          ><DesignIcon name="flash" /></v-btn
        ><span class="text-body-small text-secondary">{{
          torchAvailable ? torchLabel : 'Фонарик недоступен на этом устройстве'
        }}</span>
      </div>
      <v-sheet color="surface" rounded="lg" class="pa-4 mb-5"
        ><p class="text-title-small mb-2">Один код — одна вещь</p>
        <p class="text-body-small text-secondary">
          После считывания и сохранения вернём вас к приёмке. Подтверждение
          появится на экране склада.
        </p></v-sheet
      >
      <v-btn block @click="close()">Вернуться к приёмке</v-btn>
    </v-card>
  </v-dialog>
</template>
