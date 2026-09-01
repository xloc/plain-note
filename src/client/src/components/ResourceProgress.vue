<script setup lang="ts">
const props = defineProps<{ value: number }>()
const percent = () => Math.round(props.value * 100)
</script>

<template>
  <span v-tooltip="`Uploading ${percent()}%`" class="relative grid size-10 shrink-0 place-items-center text-xs">
    <svg class="absolute inset-0 size-full -rotate-90" viewBox="0 0 36 36">
      <circle class="fill-none stroke-stone-200" cx="18" cy="18" r="15.5" stroke-width="3" />
      <circle
        class="fill-none stroke-violet-500"
        cx="18"
        cy="18"
        r="15.5"
        stroke-dasharray="100"
        :stroke-dashoffset="100 - percent()"
        stroke-linecap="round"
        stroke-width="3"
      />
    </svg>
    <span>{{ percent() }}%</span>
  </span>
</template>
