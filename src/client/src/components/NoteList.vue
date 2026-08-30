<script setup lang="ts">
import { PencilSquareIcon } from '@heroicons/vue/24/outline'
import { useDropZone } from '@vueuse/core'
import { computed, nextTick, ref, watch } from 'vue'
import { parseMarkdownImport } from '../editor/exportNote'
import { formatUpdatedAt, groupNotesByUpdatedAt, notePreview, noteTitle } from '../notePresentation'
import { useNotesStore } from '../stores/notes'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  create: []
  open: [id: string]
  imported: []
}>()

const notes = useNotesStore()
const noteList = ref<HTMLElement | null>(null)
const noteNav = ref<HTMLElement | null>(null)
const noteSections = computed(() => groupNotesByUpdatedAt(notes.activeNotes))

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
            <button
              class="block w-full border-b border-stone-200 px-4 py-2 text-start last:border-b-0 md:hover:bg-violet-100"
              :class="{ 'md:bg-violet-100': note.id === notes.selectedId }"
              v-for="note in section.notes"
              :key="note.id"
              type="button"
              @click="emit('open', note.id)"
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
          @click="emit('create')"
        >
          <PencilSquareIcon class="size-5" />
        </button>
      </footer>
    </template>
  </aside>
</template>
