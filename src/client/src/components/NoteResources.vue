<script setup lang="ts">
import { IconDownload, IconFolder, IconTrash, IconX } from '@tabler/icons-vue'
import { computed, ref, useTemplateRef } from 'vue'
import type { NoteResource, StorageUsage } from '../../../shared/note'
import { getStorageUsage } from '../api'
import { formatResourceSize, formatResourceTime } from '../presentation'
import { useNotesStore } from '../stores/notes'
import ResourceIcon from './ResourceIcon.vue'
import ResourceProgress from './ResourceProgress.vue'

const emit = defineEmits<{ remove: [id: string] }>()
const notes = useNotesStore()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const usage = ref<StorageUsage>()
const usageLoading = ref(false)
const usageUnavailable = ref(false)
const usagePercent = computed(() =>
  usage.value ? Math.min(100, (usage.value.usedBytes / usage.value.limitBytes) * 100) : 0,
)
const cutoffPercent = computed(() =>
  usage.value ? Math.min(100, (usage.value.cutoffBytes / usage.value.limitBytes) * 100) : 0,
)
const usageColor = computed(() => {
  if (!usage.value) return 'bg-stone-500'
  if (usage.value.usedBytes >= usage.value.cutoffBytes) return 'bg-red-500'
  if (usage.value.usedBytes >= usage.value.cutoffBytes * 0.75) return 'bg-amber-500'
  return 'bg-stone-500'
})

async function open() {
  dialog.value?.showModal()
  usageLoading.value = true
  usageUnavailable.value = false
  try {
    usage.value = await getStorageUsage()
  } catch {
    usage.value = undefined
    usageUnavailable.value = true
  } finally {
    usageLoading.value = false
  }
}

function formatStorageSize(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`
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

      <div class="overflow-y-auto px-5 py-2">
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
                {{ formatResourceSize(resource.size) }} · {{ formatResourceTime(resource.createdAt) }}
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
        <p v-if="usageLoading" class="text-stone-500">Loading storage usage…</p>
        <p v-else-if="usageUnavailable" class="text-stone-500">Storage usage unavailable.</p>
        <template v-else-if="usage">
          <div
            v-tooltip="`Upload cutoff: ${formatStorageSize(usage.cutoffBytes)}`"
            class="relative h-2 w-36 overflow-hidden rounded-full bg-stone-200"
          >
            <div class="h-full rounded-full" :class="usageColor" :style="{ width: `${usagePercent}%` }" />
            <div class="absolute inset-y-0 w-px bg-stone-800" :style="{ left: `${cutoffPercent}%` }" />
          </div>
          <span class="whitespace-nowrap">
            {{ formatStorageSize(usage.usedBytes) }} / {{ formatStorageSize(usage.limitBytes) }}
          </span>
        </template>
      </div>
    </div>
  </dialog>
</template>
