<script setup lang="ts">
import { IconDownload, IconTrash } from '@tabler/icons-vue'
import { computed, ref, useTemplateRef } from 'vue'
import type { NoteResource } from '../../../shared/note'
import PopupMenu, { type PopupMenuItem } from './PopupMenu.vue'
import ResourceProgress from './ResourceProgress.vue'

export type ImageNodeState = {
  src: string
  alt: string | null
  title: string | null
  width: number | null
  resource?: NoteResource
  url?: string
  progress?: number
  selected: boolean
  editable: boolean
  unavailable?: boolean
}

const props = defineProps<{ state: ImageNodeState }>()
const emit = defineEmits<{ download: []; remove: []; resize: [width: number | null] }>()
const imageFrame = useTemplateRef<HTMLElement>('imageFrame')
const popupMenu = useTemplateRef<InstanceType<typeof PopupMenu>>('popupMenu')
const previewWidth = ref<number>()
const displayedWidth = computed(() => previewWidth.value ?? props.state.width)
const imageName = computed(() => props.state.resource?.name ?? props.state.alt ?? props.state.src)
const menuItems = computed<PopupMenuItem[]>(() => [
  {
    icon: IconDownload,
    label: 'Download',
    action: () => emit('download'),
    when: Boolean(props.state.resource),
  },
  {
    label: 'Fit automatically',
    action: () => emit('resize', null),
    when: props.state.editable && props.state.width !== null,
  },
  {
    icon: IconTrash,
    label: 'Delete',
    action: () => emit('remove'),
    destructive: true,
    when: props.state.editable,
  },
])
let resizeStart: { x: number; width: number; documentWidth: number } | undefined

function startResize(event: PointerEvent) {
  if (event.button !== 0 || !imageFrame.value?.parentElement) return
  event.preventDefault()
  event.stopPropagation()
  const frame = imageFrame.value.getBoundingClientRect()
  const documentWidth = imageFrame.value.parentElement.getBoundingClientRect().width
  resizeStart = { x: event.clientX, width: frame.width, documentWidth }
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
}

function resizeImage(event: PointerEvent) {
  if (!resizeStart) return
  const width = (resizeStart.width + (event.clientX - resizeStart.x) * 2) / resizeStart.documentWidth
  previewWidth.value = Math.min(1, Math.max(0.1, width))
}

function finishResize() {
  if (previewWidth.value !== undefined) emit('resize', previewWidth.value)
  previewWidth.value = undefined
  resizeStart = undefined
}

function cancelResize() {
  previewWidth.value = undefined
  resizeStart = undefined
}

function openContextMenu(event: MouseEvent) {
  popupMenu.value?.openAt(event)
}
</script>

<template>
  <div class="my-3 flex w-full justify-center">
    <div
      v-if="state.url"
      ref="imageFrame"
      class="group relative inline-block max-w-full leading-none"
      :class="{ 'ring-2 ring-violet-300': state.selected }"
      :style="displayedWidth === null ? undefined : { width: `${displayedWidth * 100}%` }"
      @contextmenu.prevent.stop="openContextMenu"
    >
      <img
        class="block h-auto max-w-full object-contain"
        :class="displayedWidth === null ? 'max-h-[80vh]' : 'w-full'"
        :alt="state.alt ?? state.resource?.name ?? ''"
        :src="state.url"
        :title="state.title ?? undefined"
      />
      <div v-if="state.progress !== undefined" class="pointer-events-none absolute inset-0 grid place-items-center">
        <ResourceProgress :value="state.progress" />
      </div>
      <button
        v-if="state.editable"
        v-tooltip="'Resize image'"
        class="absolute top-1/2 right-0 grid h-20 w-6 -translate-y-1/2 cursor-ew-resize touch-none place-items-center opacity-0 group-hover:opacity-100 focus:opacity-100"
        type="button"
        @pointercancel="cancelResize"
        @pointerdown="startResize"
        @pointermove="resizeImage"
        @pointerup="finishResize"
        @dragstart.prevent
      >
        <span class="block h-16 w-2 rounded-full border border-stone-300 bg-white shadow-sm" />
      </button>
    </div>
    <div
      v-else
      class="grid h-32 w-full place-items-center bg-stone-100 text-stone-500"
      @contextmenu.prevent.stop="openContextMenu"
    >
      <ResourceProgress v-if="state.progress !== undefined" :value="state.progress" />
      <span v-else>{{ state.unavailable ? 'Image unavailable' : 'Loading image…' }}</span>
    </div>
  </div>

  <PopupMenu ref="popupMenu" :items="menuItems" :title="imageName" :show-trigger="false" />
</template>
