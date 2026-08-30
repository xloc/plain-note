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
import { useDropZone, useOnline, useStorage, useSwipe } from '@vueuse/core'
import type { Component } from 'vue'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import EditorModeToggle from './components/EditorModeToggle.vue'
import IconTextPopupMenu from './components/IconTextPopupMenu.vue'
import NoteEditor from './components/NoteEditor.vue'
import {
  exportHtml,
  exportMarkdown,
  exportMarkdownWithMetadata,
  parseMarkdownImport,
  renderHtml,
} from './editor/exportNote'
import { notePreview, noteTitle, useNotesStore } from './stores/notes'

const notes = useNotesStore()
const online = useOnline()
const noteList = ref<HTMLElement | null>(null)
const noteNav = ref<HTMLElement | null>(null)
const editorScreen = ref<HTMLElement | null>(null)
const showNoteList = useStorage('plain-note:show-note-list', !notes.selectedId)
const previewMode = useStorage('plain-note:preview-mode', false)
const htmlExportPreview = ref(false)
let swipeFromEdge = false
const sync = () => void notes.sync()
const formatUpdatedAt = (timestamp: number) => {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const createNote = () => {
  showNoteList.value = false
  previewMode.value = false
  void notes.createNote()
}
const openNote = (id: string) => {
  notes.select(id)
  showNoteList.value = false
}
const importMarkdownFile = async (file: File) => {
  await notes.importNote(parseMarkdownImport(await file.text()))
  showNoteList.value = false
  previewMode.value = false
}
const { isOverDropZone } = useDropZone(noteList, {
  onDrop(files) {
    const file = files?.find(
      (candidate) => candidate.type === 'text/markdown' || /\.(md|markdown)$/i.test(candidate.name),
    )
    if (file) void importMarkdownFile(file)
  },
})
useSwipe(editorScreen, {
  threshold: 80,
  onSwipeStart: (event) => {
    const touch = event.touches[0]
    swipeFromEdge = Boolean(touch && window.innerWidth < 768 && touch.clientX <= 32)
  },
  onSwipeEnd: (event, direction) => {
    if (event.type === 'touchend' && swipeFromEdge && direction === 'right') showNoteList.value = true
    swipeFromEdge = false
  },
})
const noteSections = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const week = new Date(today)
  week.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const month = new Date(today.getFullYear(), today.getMonth(), 1)

  return [
    { label: 'Today', notes: notes.activeNotes.filter((note) => note.updatedAt >= today.getTime()) },
    {
      label: 'This week',
      notes: notes.activeNotes.filter((note) => note.updatedAt >= week.getTime() && note.updatedAt < today.getTime()),
    },
    {
      label: 'This month',
      notes: notes.activeNotes.filter((note) => note.updatedAt >= month.getTime() && note.updatedAt < week.getTime()),
    },
    {
      label: 'Older',
      notes: notes.activeNotes.filter((note) => note.updatedAt < Math.min(month.getTime(), week.getTime())),
    },
  ].filter((section) => section.notes.length)
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

onMounted(() => {
  void notes.initialize()
})
watch(online, (isOnline) => {
  if (isOnline) {
    sync()
  }
})
watch(
  () => notes.selectedNote?.updatedAt,
  async () => {
    await nextTick()
    noteNav.value?.querySelector<HTMLElement>('.md\\:bg-violet-100')?.scrollIntoView({ block: 'nearest' })
  },
  { flush: 'post' },
)
</script>

<template>
  <main class="safe-area flex h-dvh overflow-hidden">
    <aside
      ref="noteList"
      class="relative w-full shrink-0 flex-col bg-stone-100 md:flex md:w-64"
      :class="showNoteList ? 'flex' : 'hidden'"
    >
      <div
        v-if="isOverDropZone"
        class="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-xl border-2 border-dashed border-violet-500 bg-violet-100 text-violet-500"
      >
        Drop Markdown to import
      </div>
      <template v-if="notes.ready">
        <header class="shrink-0 px-4 pt-4 pb-2 md:hidden">
          <h1 class="text-4xl font-bold">Notes</h1>
        </header>
        <nav ref="noteNav" class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 md:gap-4 md:p-2">
          <section class="flex flex-col gap-2" v-for="section in noteSections" :key="section.label">
            <h2 class="px-2 text-xl font-semibold md:text-base">{{ section.label }}</h2>
            <div class="overflow-hidden rounded-xl bg-white">
              <button
                class="block w-full border-b border-stone-200 px-4 py-2 text-start last:border-b-0 md:hover:bg-violet-100"
                :class="{ 'md:bg-violet-100': note.id === notes.selectedId }"
                v-for="note in section.notes"
                :key="note.id"
                type="button"
                @click="openNote(note.id)"
              >
                <!-- title -->
                <div class="flex">
                  <div class="min-w-0 flex-1 truncate text-lg font-semibold text-stone-800 md:text-base">
                    {{ noteTitle(note.content) }}
                  </div>
                  <div class="shrink-0" v-if="note.syncState !== 'synced'">({{ note.syncState }})</div>
                </div>
                <!-- preview -->
                <div class="flex gap-2 text-sm text-stone-500 md:text-xs">
                  <span class="shrink-0">{{ formatUpdatedAt(note.updatedAt) }}</span>
                  <span class="truncate">{{ notePreview(note.content) }}</span>
                </div>
              </button>
            </div>
          </section>
        </nav>
        <footer class="flex shrink-0 justify-end md:hidden">
          <button
            class="m-2 rounded-lg bg-stone-200 p-2 text-stone-800 hover:bg-stone-100"
            type="button"
            title="New note"
            @click="createNote"
          >
            <PencilSquareIcon class="size-5" />
          </button>
        </footer>
      </template>
    </aside>

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
