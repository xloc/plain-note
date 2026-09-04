<script setup lang="ts">
import { IconDownload, IconFile, IconTrash } from '@tabler/icons-vue'
import type { NoteResource } from '../../../shared/note'
import { formatResourceTime, formatSize } from '../presentation'
import ResourceIcon from './ResourceIcon.vue'
import ResourceProgress from './ResourceProgress.vue'

export type ResourceNodeState = {
  id: string
  name: string
  resource?: NoteResource
  progress?: number
  selected: boolean
  editable: boolean
}

defineProps<{ state: ResourceNodeState }>()
const emit = defineEmits<{ download: []; remove: [] }>()
</script>

<template>
  <figure
    class="my-3 flex w-full flex-col items-center gap-2 rounded-lg"
    :class="{ 'ring-2 ring-violet-300': state.selected }"
    :data-resource-id="state.id"
  >
    <div class="flex w-full flex-wrap items-center gap-3 rounded-lg bg-stone-100 p-3 text-stone-700">
      <ResourceIcon v-if="state.resource" class="size-10 shrink-0" :resource="state.resource" />
      <IconFile v-else class="size-10 shrink-0" />
      <div class="min-w-0 flex-1 text-left">
        <strong class="block truncate">{{ state.resource?.name ?? state.name }}</strong>
        <span v-if="state.resource" class="block text-sm">
          {{ formatSize(state.resource.size) }} · {{ formatResourceTime(state.resource.createdAt) }}
        </span>
        <span v-else class="block text-sm">Missing metadata</span>
      </div>
      <ResourceProgress v-if="state.progress !== undefined" :value="state.progress" />
      <button type="button" title="Download resource" @click="emit('download')">
        <IconDownload class="size-5" />
      </button>
      <button v-if="state.editable" type="button" title="Remove resource" @click="emit('remove')">
        <IconTrash class="size-5" />
      </button>
    </div>
  </figure>
</template>
