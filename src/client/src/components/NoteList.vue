<script setup lang="ts">
import { PencilSquareIcon } from '@heroicons/vue/24/outline'
import { useDropZone } from '@vueuse/core'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { parseMarkdownImport } from '../editor/exportNote'
import { groupNotesByUpdatedAt } from '../presentation'
import { useNotesStore } from '../stores/notes'
import NoteListItem from './NoteListItem.vue'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  create: []
  open: [id: string]
  imported: []
}>()

const notes = useNotesStore()
const noteList = useTemplateRef<HTMLElement>('noteList')
const noteNav = useTemplateRef<HTMLElement>('noteNav')
const noteSections = computed(() => groupNotesByUpdatedAt(notes.activeNotes))
const revealedNoteId = ref<string>()

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
    noteNav.value?.querySelector<HTMLElement>('.md\\:bg-violet-100')?.scrollIntoView({ block: 'nearest' })
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
      <nav ref="noteNav" class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 md:gap-4 md:p-2">
        <section class="flex flex-col gap-2" v-for="section in noteSections" :key="section.label">
          <h2 class="px-2 text-xl font-semibold md:text-base">{{ section.label }}</h2>
          <div class="overflow-hidden rounded-xl bg-white">
            <NoteListItem
              v-for="note in section.notes"
              :key="note.id"
              :note="note"
              :selected="note.id === notes.selectedId"
              :revealed="note.id === revealedNoteId"
              @close="revealedNoteId = undefined"
              @delete="deleteNote(note.id)"
              @open="openNote(note.id)"
              @reveal="revealedNoteId = note.id"
            />
          </div>
        </section>
      </nav>
      <footer class="flex shrink-0 justify-end md:hidden">
        <button
          class="m-2 rounded-lg bg-stone-200 p-2 text-stone-800 hover:bg-stone-100"
          type="button"
          title="New note"
          @click="emit('create')"
        >
          <PencilSquareIcon class="size-5" />
        </button>
      </footer>
    </template>
  </aside>
</template>
