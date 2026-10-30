<script setup lang="ts">
import { computed } from 'vue';
import type { ScanResult } from '../inventory-api';
const props = defineProps<{ result: ScanResult }>();
const details = computed(() =>
  [
    props.result.unit.article ? `Арт. ${props.result.unit.article}` : '',
    props.result.unit.color,
    props.result.unit.size ? `Размер ${props.result.unit.size}` : '',
  ]
    .filter(Boolean)
    .join(' · '),
);
</script>
<template>
  <p v-if="details" class="text-label-small text-secondary mt-1">
    {{ details }}
  </p>
</template>
