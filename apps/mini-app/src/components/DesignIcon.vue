<script setup lang="ts">
import { computed } from 'vue';
import { icons, type DesignIconName } from '../design/icons';
const props = defineProps<{ name: DesignIconName; monochrome?: boolean }>();
const icon = computed(() => icons[props.name]);
</script>
<template>
  <span
    v-if="monochrome"
    class="design-icon design-icon-monochrome"
    :style="{
      width: `${icon.width}px`,
      height: `${icon.height}px`,
      maskImage: `url(${JSON.stringify(icon.src)})`,
    }"
    aria-hidden="true"
  />
  <img
    v-else
    class="design-icon"
    :src="icon.src"
    :width="icon.width"
    :height="icon.height"
    alt=""
    aria-hidden="true"
  />
</template>
