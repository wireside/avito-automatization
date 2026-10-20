<script setup lang="ts">
import { computed } from 'vue';
import black from '../assets/figma/mobile-18e44.svg';
import gray from '../assets/figma/desktop-d747b.svg';
import beige from '../assets/figma/desktop-8cdd5.svg';
const props = defineProps<{ color?: string | null }>();
const thumbnail = computed(() =>
  /беж|beige/i.test(props.color ?? '')
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
    <img :src="thumbnail" width="40" height="54" alt="" aria-hidden="true" />
  </v-sheet>
</template>
