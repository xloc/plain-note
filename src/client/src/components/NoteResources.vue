<script setup lang="ts">
import { IconDownload, IconFolder, IconTrash, IconX } from '@tabler/icons-vue'
import { computed, useTemplateRef } from 'vue'
import type { NoteResource } from '../../../shared/note'
import { formatResourceTime, formatSize } from '../presentation'
import { useNotesStore } from '../stores/notes'
import { useStorageStatusStore } from '../stores/storageStatus'
import ResourceIcon from './ResourceIcon.vue'
import ResourceProgress from './ResourceProgress.vue'

const emit = defineEmits<{ remove: [id: string] }>()
const notes = useNotesStore()
const storage = useStorageStatusStore()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const usagePercent = computed(() =>
  storage.status ? Math.min(100, (storage.status.usedBytes / storage.status.limitBytes) * 100) : 0,
)
const cutoffPercent = computed(() =>
  storage.status ? Math.min(100, (storage.status.cutoffBytes / storage.status.limitBytes) * 100) : 0,
)
const usageColor = computed(() => {
  if (!storage.status) return 'bg-stone-500'
  if (storage.status.usedBytes >= storage.status.cutoffBytes) return 'bg-red-500'
  if (storage.status.usedBytes >= storage.status.cutoffBytes * 0.75) return 'bg-amber-500'
  return 'bg-stone-500'
})

function open() {
  dialog.value?.showModal()
  void storage.refresh()
}

function download(resource: NoteResource) {
  if (notes.selectedNote) void notes.downloadResource(notes.selectedNote.id, resource)
}
</script>

<template>
  <button
    class="flex items-center gap-1 rounded-lg bg-stone-100 p-2 text-stone-700 hover:bg-stone-200"
    type="button"
    title="Manage resources"
    @click="open"
  >
    <IconFolder class="size-5" />
    <span class="hidden sm:inline">{{ notes.selectedNote?.resources.length ?? 0 }}</span>
  </button>

  <dialog
    ref="dialog"
    class="m-auto w-[min(44rem,calc(100%-2rem))] rounded-xl bg-white p-0 text-stone-800 shadow-xl backdrop:bg-stone-900/40"
    @click.self="dialog?.close()"
  >
    <div class="flex max-h-[min(80vh,48rem)] flex-col">
      <header class="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
        <h2 class="text-lg font-semibold">Resources</h2>
        <button
          class="cursor-pointer rounded-lg p-1 text-stone-500 hover:bg-stone-100"
          type="button"
          title="Close"
          @click="dialog?.close()"
        >
          <IconX class="size-5" />
        </button>
      </header>

      <div class="overflow-y-auto px-5 pt-2 pb-5">
        <ul v-if="notes.selectedNote?.resources.length" class="space-y-2">
          <li
            v-for="resource in notes.selectedNote.resources"
            :key="resource.id"
            class="flex items-center gap-3 rounded-lg border border-stone-200 p-3"
          >
            <ResourceIcon class="size-9 shrink-0 text-stone-600" :resource="resource" />
            <div class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ resource.name }}</span>
              <span class="block truncate text-sm text-stone-500">
                {{ formatSize(resource.size) }} · {{ formatResourceTime(resource.createdAt) }}
              </span>
            </div>
            <ResourceProgress
              v-if="notes.resourceProgress[resource.id] !== undefined"
              :value="notes.resourceProgress[resource.id]"
            />
            <button
              class="cursor-pointer rounded-lg p-2 hover:bg-stone-100"
              type="button"
              title="Download"
              @click="download(resource)"
            >
              <IconDownload class="size-5" />
            </button>
            <button
              class="cursor-pointer rounded-lg p-2 text-red-600 hover:bg-red-50"
              type="button"
              title="Remove"
              @click="emit('remove', resource.id)"
            >
              <IconTrash class="size-5" />
            </button>
          </li>
        </ul>
        <p v-else class="py-8 text-center text-stone-500">This note has no resources.</p>
      </div>

      <div class="flex w-fit items-center gap-3 px-5 pt-3 pb-5 text-sm">
        <p v-if="storage.loading && !storage.status" class="text-stone-500">Loading storage usage…</p>
        <p v-else-if="storage.message && !storage.status" class="text-stone-500">Storage usage unavailable.</p>
        <template v-else-if="storage.status">
          <div
            v-tooltip="`Upload cutoff: ${formatSize(storage.status.cutoffBytes)}`"
            class="relative h-2 w-36 overflow-hidden rounded-full bg-stone-200"
          >
            <div class="h-full rounded-full" :class="usageColor" :style="{ width: `${usagePercent}%` }" />
            <div class="absolute inset-y-0 w-px bg-stone-800" :style="{ left: `${cutoffPercent}%` }" />
          </div>
          <span class="whitespace-nowrap">
            {{ formatSize(storage.status.usedBytes) }} / {{ formatSize(storage.status.limitBytes) }}
          </span>
        </template>
      </div>
    </div>
  </dialog>
</template>
