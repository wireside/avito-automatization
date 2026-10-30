<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import denim from '../assets/figma/orders-denim.svg';
import black from '../assets/figma/mobile-18e44.svg';
import gray from '../assets/figma/desktop-d747b.svg';
import beige from '../assets/figma/desktop-8cdd5.svg';
const props = defineProps<{
  color?: string | null;
  kind?: 'denim';
  src?: string | null | undefined;
}>();
const failed = ref(false);
watch(
  () => props.src,
  () => {
    failed.value = false;
  },
);
const thumbnail = computed(() =>
  props.kind === 'denim'
    ? denim
    : /беж|beige/i.test(props.color ?? '')
      ? beige
      : /сер|gray|grey/i.test(props.color ?? '')
        ? gray
        : black,
);
</script>
<template>
  <v-sheet
    color="raised"
    rounded="md"
    width="56"
    height="64"
    class="d-flex align-center justify-center flex-shrink-0"
  >
    <img
      v-if="src && !failed"
      :src="src"
      width="56"
      height="64"
      class="listing-photo"
      alt="Фото объявления Авито"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <img
      v-else
      :src="thumbnail"
      :data-illustration="kind"
      width="40"
      height="54"
      alt=""
      aria-hidden="true"
    />
  </v-sheet>
</template>

<style scoped>
.listing-photo {
  object-fit: cover;
  border-radius: inherit;
}
</style>
