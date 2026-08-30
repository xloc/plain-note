<script setup lang="ts">
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  CloudArrowUpIcon,
  ExclamationCircleIcon,
  PencilSquareIcon,
  SignalSlashIcon,
} from '@heroicons/vue/24/outline'
import { IconDatabaseX, IconEye, IconFileTypeHtml, IconMarkdown, IconTrash } from '@tabler/icons-vue'
import { useOnline, useStorage, useSwipe } from '@vueuse/core'
import type { Component } from 'vue'
import { computed, ref, watch } from 'vue'
import EditorModeToggle from './components/EditorModeToggle.vue'
import IconTextPopupMenu from './components/IconTextPopupMenu.vue'
import NoteEditor from './components/NoteEditor.vue'
import NoteList from './components/NoteList.vue'
import { exportHtml, exportMarkdown, exportMarkdownWithMetadata, renderHtml } from './editor/exportNote'
import { noteTitle } from './notePresentation'
import { useNoteRoute } from './noteRoute'
import { useNotesStore } from './stores/notes'

const notes = useNotesStore()
const { openNote: openNoteRoute } = useNoteRoute(notes)
const online = useOnline()
const editorScreen = ref<HTMLElement | null>(null)
const showNoteList = useStorage('plain-note:show-note-list', !notes.selectedId)
const previewMode = useStorage('plain-note:preview-mode', false)
const htmlExportPreview = ref(false)
let swipeFromEdge = false
const sync = () => void notes.sync()
const createNote = () => {
  showNoteList.value = false
  previewMode.value = false
  void notes.createNote()
}
const openNote = (id: string) => {
  showNoteList.value = false
  void openNoteRoute(id)
}
const showImportedNote = () => {
  showNoteList.value = false
  previewMode.value = false
}
useSwipe(editorScreen, {
  threshold: 80,
  onSwipeStart: (event) => {
    const touch = event.touches[0]
    const target = event.target instanceof Element ? event.target : null
    swipeFromEdge = Boolean(
      touch && window.innerWidth < 768 && touch.clientX <= 32 && !target?.closest('.table-scroll'),
    )
  },
  onSwipeEnd: (event, direction) => {
    if (event.type === 'touchend' && swipeFromEdge && direction === 'right') showNoteList.value = true
    swipeFromEdge = false
  },
})
const wordCount = computed(
  () => notes.selectedNote?.content.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0,
)
const characterCount = computed(() => [...(notes.selectedNote?.content ?? '')].length)
const htmlExportPreviewSource = computed(() => {
  const note = notes.selectedNote
  return note ? renderHtml(note.content, noteTitle(note.content)) : ''
})
const resetLocalData = () => {
  if (window.confirm('Delete all local notes and reload them from the server? Unsynced changes will be lost.')) {
    void notes.resetLocalData()
  }
}
const exportSelectedMarkdown = (): void => {
  const note = notes.selectedNote
  if (note) exportMarkdown(note.content, noteTitle(note.content))
}
const exportSelectedMarkdownWithMetadata = (): void => {
  const note = notes.selectedNote
  if (note) exportMarkdownWithMetadata(note, noteTitle(note.content))
}
const exportSelectedHtml = (): void => {
  const note = notes.selectedNote
  if (note) exportHtml(note.content, noteTitle(note.content))
}
const toggleHtmlExportPreview = (): void => {
  htmlExportPreview.value = !htmlExportPreview.value
}
const noteMenuItems = computed<
  { icon: Component; label: string; action: () => void; disabled?: boolean; destructive?: boolean }[]
>(() => [
  { icon: IconMarkdown, label: 'Export Markdown', action: exportSelectedMarkdown },
  {
    icon: IconMarkdown,
    label: 'Export Markdown with metadata',
    action: exportSelectedMarkdownWithMetadata,
  },
  { icon: IconFileTypeHtml, label: 'Export HTML', action: exportSelectedHtml },
  {
    icon: IconEye,
    label: htmlExportPreview.value ? 'Hide HTML preview' : 'Preview exported HTML',
    action: toggleHtmlExportPreview,
  },
  { icon: IconTrash, label: 'Delete note', action: () => void notes.deleteSelected(), destructive: true },
  {
    icon: IconDatabaseX,
    label: 'Reset local data',
    action: resetLocalData,
    disabled: notes.syncing,
    destructive: true,
  },
])

watch(online, (isOnline) => {
  if (isOnline) {
    sync()
  }
})
</script>

<template>
  <main class="safe-area flex h-dvh overflow-hidden">
    <NoteList :visible="showNoteList" @create="createNote" @open="openNote" @imported="showImportedNote" />

    <template v-if="notes.ready">
      <article
        ref="editorScreen"
        class="relative min-w-0 flex-1 flex-col md:block"
        :class="showNoteList ? 'hidden md:block' : 'flex'"
        v-if="notes.selectedNote"
      >
        <header class="z-10 m-2 flex shrink-0 items-center justify-between md:absolute md:top-0 md:right-0 md:left-0">
          <div class="flex items-center gap-2">
            <button class="p-2 text-stone-800 md:hidden" type="button" title="Notes" @click="showNoteList = true">
              <ChevronLeftIcon class="size-5" />
            </button>
            <button
              class="rounded-lg bg-stone-100 p-2 text-stone-800 hover:bg-stone-100"
              type="button"
              title="New note"
              @click="createNote"
            >
              <PencilSquareIcon class="size-5" />
            </button>
            <button
              class="rounded-lg bg-stone-100 p-2 text-stone-700 hover:bg-stone-100"
              type="button"
              title="Sync now"
              :disabled="notes.syncing"
              @click="notes.sync"
            >
              <ArrowPathIcon class="size-5" />
            </button>
          </div>
          <div class="flex items-center gap-2">
            <EditorModeToggle v-model="previewMode" />
            <IconTextPopupMenu :items="noteMenuItems" />
          </div>
        </header>
        <div class="min-h-0 flex-1 md:absolute md:inset-0" :class="{ 'grid grid-rows-2': htmlExportPreview }">
          <NoteEditor
            class="h-full min-h-0 min-w-0 overflow-y-auto"
            :document-id="notes.selectedNote.id"
            :editable="!previewMode"
            :model-value="notes.selectedNote.content"
            @update:model-value="notes.updateSelected({ content: $event })"
          />
          <iframe
            v-if="htmlExportPreview"
            class="h-full min-h-0 w-full border-t-2 border-stone-200"
            title="HTML export preview"
            :srcdoc="htmlExportPreviewSource"
          />
        </div>
        <footer
          class="flex shrink-0 items-center gap-3 self-end rounded-tl-lg bg-stone-100 px-4 py-1 text-sm text-stone-700 md:absolute md:right-0 md:bottom-0"
        >
          <span class="hidden sm:inline"> {{ wordCount }} {{ wordCount === 1 ? 'word' : 'words' }} </span>
          <span class="hidden sm:inline">
            {{ characterCount }} {{ characterCount === 1 ? 'character' : 'characters' }}
          </span>
          <span role="status" :title="notes.syncMessage">
            <SignalSlashIcon v-if="!online" class="size-5 text-stone-400" />
            <ArrowPathIcon v-else-if="notes.syncing" class="size-5 text-blue-500" />
            <ExclamationCircleIcon
              v-else-if="
                notes.syncMessage !== 'Synced' && notes.syncMessage !== 'Pending' && notes.syncMessage !== 'Local only'
              "
              class="size-5 text-red-500"
            />
            <CloudArrowUpIcon v-else-if="notes.selectedNote?.syncState === 'pending'" class="size-5 text-amber-500" />
            <CheckCircleIcon v-else class="size-5 text-green-500" />
          </span>
        </footer>
      </article>
    </template>
  </main>
</template>

<style scoped>
.safe-area {
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
</style>
