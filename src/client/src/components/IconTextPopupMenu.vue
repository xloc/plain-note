<script setup lang="ts">
import { EllipsisHorizontalIcon } from '@heroicons/vue/24/outline'
import { onClickOutside } from '@vueuse/core'
import type { Component } from 'vue'
import { ref } from 'vue'

defineProps<{
  items: {
    icon: Component
    label: string
    action: () => void
    disabled?: boolean
    destructive?: boolean
  }[]
}>()

const menu = ref<HTMLElement | null>(null)
const open = ref(false)

onClickOutside(
  menu,
  () => {
    open.value = false
  },
  { detectIframe: true },
)
</script>

<template>
  <div ref="menu" class="relative" @keydown.esc="open = false">
    <button
      class="rounded-lg bg-stone-100 p-2 text-stone-700 hover:bg-stone-50"
      type="button"
      title="More actions"
      @click="open = !open"
    >
      <EllipsisHorizontalIcon class="size-5" />
    </button>
    <div
      v-if="open"
      class="absolute right-0 mt-1 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg"
      @click.capture="open = false"
    >
      <button
        v-for="item in items"
        :key="item.label"
        class="flex w-full items-center gap-2 border-b border-stone-200 px-3 py-2 text-sm whitespace-nowrap last:border-b-0 disabled:opacity-50"
        :class="item.destructive ? 'text-red-500 hover:bg-red-50' : 'text-stone-700 hover:bg-stone-50'"
        type="button"
        :disabled="item.disabled"
        @click="item.action"
      >
        <component :is="item.icon" class="size-4" />
        {{ item.label }}
      </button>
    </div>
  </div>
</template>
