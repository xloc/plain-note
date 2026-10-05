<script setup lang="ts">
import { MagnifyingGlassIcon, PencilSquareIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { IconLoader2, IconTrash } from '@tabler/icons-vue'
import { useDropZone, useResizeObserver } from '@vueuse/core'
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from 'vue'
import type { LocalNote } from '../db'
import { parseMarkdownImport } from '../editor/exportNote'
import { groupNotesByUpdatedAt, NOTE_LIST_OVERSCAN, windowNoteSections } from '../presentation'
import { useNotesStore } from '../stores/notes'
import { useNoteSearch } from '../useNoteSearch'
import NoteListItem from './NoteListItem.vue'
import PopupMenu, { type PopupMenuItem } from './PopupMenu.vue'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  create: []
  open: [id: string]
  imported: []
}>()

const notes = useNotesStore()
const noteList = useTemplateRef<HTMLElement>('noteList')
const noteNav = useTemplateRef<HTMLElement>('noteNav')
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
const search = ref('')
const geometry = reactive({
  scrollTop: 0,
  viewportHeight: 0,
  rowHeight: 0,
  headingHeight: 0,
  sectionGap: 0,
  paddingTop: 0,
})
const resultLimit = computed(() =>
  geometry.viewportHeight
    ? Math.ceil((geometry.scrollTop + geometry.viewportHeight) / (geometry.rowHeight || 64)) + NOTE_LIST_OVERSCAN
    : 0,
)
const {
  terms: searchTerms,
  matches,
  complete,
  showSpinner,
} = useNoteSearch(
  computed(() => notes.activeNotes),
  search,
  resultLimit,
)
const groupedNotes = computed(() => groupNotesByUpdatedAt(matches.value))
const noteSections = computed(() => windowNoteSections(groupedNotes.value, geometry))
const revealedNoteId = ref<string>()
const popupMenu = useTemplateRef<InstanceType<typeof PopupMenu>>('popupMenu')
const contextNote = ref<LocalNote>()
const menuItems = computed<PopupMenuItem[]>(() => {
  const note = contextNote.value
  return note
    ? [
        {
          icon: IconTrash,
          label: 'Delete note',
          action: () => deleteNote(note.id),
          disabled: !notes.editable,
          destructive: true,
        },
      ]
    : []
})

function openNoteMenu(note: LocalNote, event: MouseEvent) {
  contextNote.value = note
  popupMenu.value?.openAt(event)
}

function measureList() {
  const nav = noteNav.value
  if (!nav) return
  const section = nav.querySelector('section')
  const heading = section?.querySelector('h2')
  const row = nav.querySelector('[data-note-row]')
  const style = getComputedStyle(nav)
  geometry.viewportHeight = nav.clientHeight
  geometry.scrollTop = nav.scrollTop
  geometry.paddingTop = parseFloat(style.paddingTop) || 0
  geometry.sectionGap = parseFloat(style.rowGap) || 0
  if (heading && section) {
    geometry.headingHeight =
      heading.getBoundingClientRect().height + (parseFloat(getComputedStyle(section).rowGap) || 0)
  }
  const rowHeight = row?.getBoundingClientRect().height
  if (rowHeight) geometry.rowHeight = rowHeight
}

useResizeObserver(noteNav, measureList)
watch(noteSections, measureList, { flush: 'post' })
watch(searchTerms, () => {
  if (noteNav.value) noteNav.value.scrollTop = 0
  geometry.scrollTop = 0
  revealedNoteId.value = undefined
})

function clearSearch() {
  search.value = ''
  searchInput.value?.focus()
}

function openNote(id: string) {
  revealedNoteId.value = undefined
  emit('open', id)
}

function deleteNote(id: string) {
  revealedNoteId.value = undefined
  void notes.deleteNote(id)
}

const { isOverDropZone } = useDropZone(noteList, {
  async onDrop(files) {
    if (!notes.editable) return
    const file = files?.find(
      (candidate) => candidate.type === 'text/markdown' || /\.(md|markdown)$/i.test(candidate.name),
    )
    if (!file) return
    await notes.importNote(parseMarkdownImport(await file.text()))
    emit('imported')
  },
})

watch(
  () => notes.selectedNote?.updatedAt,
  async () => {
    await nextTick()
    if (searchTerms.value.length || !noteNav.value || !geometry.rowHeight) return
    for (const section of noteSections.value) {
      const index = section.notes.findIndex((note) => note.id === notes.selectedId)
      if (index < 0) continue
      const top = section.rowsTop + index * geometry.rowHeight
      const bottom = top + geometry.rowHeight
      if (top < geometry.scrollTop) noteNav.value.scrollTop = top
      else if (bottom > geometry.scrollTop + geometry.viewportHeight) {
        noteNav.value.scrollTop = bottom - geometry.viewportHeight
      }
      geometry.scrollTop = noteNav.value.scrollTop
      break
    }
  },
  { flush: 'post' },
)
</script>

<template>
  <aside
    ref="noteList"
    class="relative w-full shrink-0 flex-col bg-stone-100 md:flex md:w-64"
    :class="visible ? 'flex' : 'hidden'"
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
      <div class="shrink-0 px-4 pb-2 md:p-2">
        <div
          class="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-stone-500 focus-within:ring-2 focus-within:ring-violet-300"
        >
          <IconLoader2 v-if="showSpinner" class="size-5 shrink-0 animate-spin" />
          <MagnifyingGlassIcon v-else class="size-5 shrink-0" />
          <input
            ref="searchInput"
            v-model="search"
            class="min-w-0 flex-1 bg-transparent text-base text-stone-800 outline-none md:text-sm"
            type="text"
            inputmode="search"
            title="Search notes"
            placeholder="Search notes"
            @keydown.esc="clearSearch"
          />
          <button v-if="search" class="shrink-0" type="button" title="Clear search" @click="clearSearch">
            <XMarkIcon class="size-5" />
          </button>
        </div>
      </div>
      <nav
        ref="noteNav"
        class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 md:gap-4 md:p-2"
        @scroll.passive="geometry.scrollTop = noteNav?.scrollTop ?? 0"
      >
        <p v-if="searchTerms.length && complete && !matches.length">No matching notes</p>
        <section class="flex shrink-0 flex-col gap-2" v-for="section in noteSections" :key="section.label">
          <h2 class="px-2 text-xl font-semibold md:text-base">{{ section.label }}</h2>
          <div class="overflow-hidden rounded-xl bg-white">
            <div v-if="section.start" :style="{ height: `${section.start * geometry.rowHeight}px` }" />
            <NoteListItem
              v-for="note in section.notes.slice(section.start, section.end)"
              :key="note.id"
              :note="note"
              :search-terms="searchTerms"
              :selected="note.id === notes.selectedId"
              :revealed="note.id === revealedNoteId"
              @close="revealedNoteId = undefined"
              @contextmenu="openNoteMenu(note, $event)"
              @delete="deleteNote(note.id)"
              @open="openNote(note.id)"
              @reveal="revealedNoteId = note.id"
            />
            <div
              v-if="section.end < section.notes.length"
              :style="{ height: `${(section.notes.length - section.end) * geometry.rowHeight}px` }"
            />
          </div>
        </section>
      </nav>
      <footer class="flex shrink-0 justify-end md:hidden">
        <button
          class="m-2 rounded-lg bg-stone-200 p-2 text-stone-800 hover:bg-stone-100"
          type="button"
          title="New note"
          :disabled="!notes.editable"
          @click="emit('create')"
        >
          <PencilSquareIcon class="size-5" />
        </button>
      </footer>
    </template>
  </aside>
  <PopupMenu ref="popupMenu" :items="menuItems" :show-trigger="false" />
</template>
