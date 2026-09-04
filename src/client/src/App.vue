<script setup lang="ts">
import { ChevronLeftIcon, PencilSquareIcon } from '@heroicons/vue/24/outline'
import {
  IconDatabase,
  IconDatabaseX,
  IconEye,
  IconFileTypeHtml,
  IconMarkdown,
  IconPaperclip,
  IconTrash,
} from '@tabler/icons-vue'
import { useFileDialog, useStorage, useSwipe } from '@vueuse/core'
import { computed, ref, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCloudStatus } from './cloudStatus'
import CloudStatusIcon from './components/CloudStatusIcon.vue'
import EditorModeToggle from './components/EditorModeToggle.vue'
import NoteEditor from './components/NoteEditor.vue'
import NoteList from './components/NoteList.vue'
import NoteResources from './components/NoteResources.vue'
import PopupMenu, { type PopupMenuItem } from './components/PopupMenu.vue'
import Sessions from './Sessions.vue'
import StorageStatus from './StorageStatus.vue'
import { exportHtml, exportMarkdown, exportMarkdownWithMetadata, renderHtml } from './editor/exportNote'
import { noteTitle } from './presentation'
import { useNoteRoute } from './noteRoute'
import { useCloudSyncStore } from './stores/cloudSync'
import { useNotesStore } from './stores/notes'

const notes = useNotesStore()
const cloudSync = useCloudSyncStore()
const route = useRoute()
const router = useRouter()
const { openNote: openNoteRoute } = useNoteRoute(notes)
const editorScreen = useTemplateRef<HTMLElement>('editorScreen')
const noteEditor = useTemplateRef<InstanceType<typeof NoteEditor>>('noteEditor')
const showNoteList = useStorage('plain-note:show-note-list', !notes.selectedId)
const previewMode = useStorage('plain-note:preview-mode', false)
const htmlExportPreview = ref(false)
const fileDialog = useFileDialog({ multiple: true, reset: true })
const cloud = useCloudStatus()
let swipeFromEdge = false
const openSyncStatus = () => void router.push({ query: { ...route.query, sessions: '1' } })
const openStorageStatus = () => void router.push({ query: { ...route.query, storage: '1' } })
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
fileDialog.onChange((files) => {
  if (files?.length) noteEditor.value?.attachFiles(Array.from(files))
})
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
  const hasUnsyncedChanges = notes.notes.some((note) => note.syncState === 'pending')
  if (hasUnsyncedChanges) {
    if (!window.confirm('Some notes are not synced. Discard their changes?')) return
  }
  void cloudSync.resetLocalData()
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
const noteMenuItems = computed<PopupMenuItem[]>(() => [
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
  { icon: IconDatabase, label: 'Storage status', action: openStorageStatus },
  {
    icon: IconDatabaseX,
    label: 'Reset local data',
    action: resetLocalData,
    disabled: notes.syncing,
    destructive: true,
  },
])
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
              class="rounded-lg bg-stone-100 p-2 text-stone-700 hover:bg-stone-200"
              type="button"
              :title="cloud.status.value.title"
              @click="openSyncStatus"
            >
              <CloudStatusIcon :status="cloud.status.value.kind" class="size-5" />
            </button>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="!previewMode"
              class="rounded-lg bg-stone-100 p-2 text-stone-700 hover:bg-stone-200 sm:hidden"
              type="button"
              title="Attach files"
              @click="fileDialog.open()"
            >
              <IconPaperclip class="size-5" />
            </button>
            <NoteResources @remove="noteEditor?.removeResource($event)" />
            <EditorModeToggle v-model="previewMode" />
            <PopupMenu :items="noteMenuItems" />
          </div>
        </header>
        <div class="min-h-0 flex-1 md:absolute md:inset-0" :class="{ 'grid grid-rows-2': htmlExportPreview }">
          <NoteEditor
            ref="noteEditor"
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
        </footer>
      </article>
    </template>
    <Sessions />
    <StorageStatus />
  </main>
</template>

<style scoped>
.safe-area {
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
</style>
