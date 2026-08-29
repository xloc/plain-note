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
import { IconDatabaseX, IconTrash } from '@tabler/icons-vue'
import { useOnline, useStorage, useSwipe } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import EditorModeToggle from './components/EditorModeToggle.vue'
import IconTextPopupMenu from './components/IconTextPopupMenu.vue'
import NoteEditor from './components/NoteEditor.vue'
import { notePreview, noteTitle, useNotesStore } from './stores/notes'

const notes = useNotesStore()
const online = useOnline()
const noteNav = ref<HTMLElement | null>(null)
const editorScreen = ref<HTMLElement | null>(null)
const showNoteList = useStorage('plain-note:show-note-list', !notes.selectedId)
const previewMode = useStorage('plain-note:preview-mode', false)
let swipeFromEdge = false
const sync = () => void notes.sync()
const formatUpdatedAt = (timestamp: number) => {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
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
const resetLocalData = () => {
  if (window.confirm('Delete all local notes and reload them from the server? Unsynced changes will be lost.')) {
    void notes.resetLocalData()
  }
}
const noteMenuItems = computed(() => [
  { icon: IconTrash, label: 'Delete note', action: () => void notes.deleteSelected() },
  {
    icon: IconDatabaseX,
    label: 'Reset local data',
    action: resetLocalData,
    disabled: notes.syncing,
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
    <aside class="w-full shrink-0 flex-col bg-stone-100 md:flex md:w-64" :class="showNoteList ? 'flex' : 'hidden'">
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
        <NoteEditor
          class="min-h-0 flex-1 overflow-y-auto md:absolute md:inset-0"
          :document-id="notes.selectedNote.id"
          :editable="!previewMode"
          :model-value="notes.selectedNote.content"
          @update:model-value="notes.updateSelected({ content: $event })"
        />
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
