<script setup lang="ts">
import { IconTrash } from '@tabler/icons-vue'
import { useSwipe } from '@vueuse/core'
import { useTemplateRef } from 'vue'
import type { LocalNote } from '../db'
import { formatDateTime, notePreview, noteTitle } from '../presentation'

const props = defineProps<{ note: LocalNote; selected: boolean; revealed: boolean }>()
const emit = defineEmits<{ open: []; reveal: []; close: []; delete: [] }>()
const row = useTemplateRef<HTMLElement>('row')

useSwipe(row, {
  threshold: 50,
  passive: false,
  onSwipeEnd(event, direction) {
    if (direction !== 'left' && direction !== 'right') return
    event.preventDefault()
    if (direction === 'left') emit('reveal')
    else emit('close')
  },
})

function open() {
  if (props.revealed) emit('close')
  else emit('open')
}
</script>

<template>
  <div ref="row" class="relative overflow-hidden border-b border-stone-200 last:border-b-0">
    <button
      class="absolute inset-y-0 right-0 flex w-30 items-center justify-center gap-1 bg-red-500 text-white"
      type="button"
      title="Delete note"
      @click="emit('delete')"
    >
      <IconTrash class="size-5" />
      Delete
    </button>
    <button
      class="relative block w-full bg-white px-4 py-2 text-start transition-transform md:hover:bg-violet-100"
      :class="{ '-translate-x-30': revealed, 'md:bg-violet-100': selected }"
      type="button"
      @click="open"
    >
      <div class="flex">
        <div class="min-w-0 flex-1 truncate text-lg font-semibold text-stone-800 md:text-base">
          {{ noteTitle(note.content) }}
        </div>
        <div v-if="note.syncState !== 'synced'" class="shrink-0">({{ note.syncState }})</div>
      </div>
      <div class="flex gap-2 text-sm text-stone-500 md:text-xs">
        <span class="shrink-0">{{ formatDateTime(note.updatedAt) }}</span>
        <span class="truncate">{{ notePreview(note.content) }}</span>
      </div>
    </button>
  </div>
</template>
