<script setup lang="ts">
import { computed } from 'vue';
import { icons, type DesignIconName } from '../design/icons';
const props = defineProps<{ name: DesignIconName }>();
const icon = computed(() => icons[props.name]);
</script>
<template>
  <img
    class="design-icon"
    :src="icon.src"
    :width="icon.width"
    :height="icon.height"
    alt=""
    aria-hidden="true"
  />
</template>
