<script setup lang="ts">
import {
  ArrowPathIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  ExclamationCircleIcon,
  PencilSquareIcon,
  SignalSlashIcon,
  TrashIcon,
} from '@heroicons/vue/24/outline'
import { useOnline } from '@vueuse/core'
import { computed, onMounted, watch } from 'vue'
import NoteEditor from './components/NoteEditor.vue'
import { notePreview, noteTitle, useNotesStore } from './stores/notes'

const notes = useNotesStore()
const online = useOnline()
const sync = () => void notes.sync()
const wordCount = computed(() => notes.selectedNote?.content.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0)
const characterCount = computed(() => [...(notes.selectedNote?.content ?? '')].length)
const resetLocalData = () => {
  if (window.confirm('Delete all local notes and reload them from the server? Unsynced changes will be lost.'))
    void notes.resetLocalData()
}

onMounted(() => {
  void notes.initialize()
})
watch(online, (isOnline) => {
  if (isOnline)
    sync()
})
</script>

<template>
  <main class="flex h-screen overflow-hidden">
    <aside class="flex w-64 shrink-0 flex-col bg-stone-100">
      <template v-if="notes.ready">
        <nav class="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <button class="p-2 text-start hover:bg-violet-100" v-for="note in notes.activeNotes" :key="note.id"
            type="button" @click="notes.select(note.id)">
            <!-- title -->
            <div class="flex">
              <div class="min-w-0 flex-1 truncate font-semibold text-stone-800">
                {{ noteTitle(note.content) }}
              </div>
              <div class="shrink-0" v-if="note.syncState !== 'synced'">({{ note.syncState }})</div>
            </div>
            <!-- preview -->
            <div class="line-clamp-1 h-5 leading-5 text-sm text-stone-800">
              {{ notePreview(note.content) }}
            </div>
          </button>
        </nav>


      </template>
    </aside>

    <template v-if="notes.ready">
      <article class="flex min-w-0 flex-1 flex-col relative" v-if="notes.selectedNote">
        <header class="flex items-center justify-between m-1">
          <div class="flex items-center gap-2">
            <button class="p-2 hover:bg-stone-100 text-stone-700 rounded-lg" type="button" title="New note"
              @click="notes.createNote">
              <PencilSquareIcon class="size-5" />
            </button>
            <button v-if="notes.selectedNote && !notes.selectedNote.deleted"
              class="p-2 hover:bg-red-50 rounded-lg text-red-500" type="button" title="Delete note"
              @click="notes.deleteSelected">
              <TrashIcon class="size-5" />
            </button>
            <button class="p-2 hover:bg-stone-100 text-stone-700 rounded-lg" type="button" title="Sync now"
              :disabled="notes.syncing" @click="notes.sync">
              <ArrowPathIcon class="size-5" />
            </button>
            <button class="p-2 hover:bg-red-50 text-red-500 rounded-lg" type="button" title="Reset local data"
              :disabled="notes.syncing" @click="resetLocalData">
              <div class="relative">
                <TrashIcon class="size-5" />
                <span class="size-2 rounded-full bg-red-500 absolute bottom-0 right-0">
                </span>
              </div>
            </button>
          </div>
        </header>
        <NoteEditor class="min-h-0 flex-1 overflow-auto" :model-value="notes.selectedNote.content"
          @update:model-value="notes.updateSelected({ content: $event })" />
        <footer
          class="flex items-center gap-3 absolute right-0 bottom-0 px-4 py-1 text-stone-700 text-sm bg-stone-100 rounded-tl-lg">
          <span class="">
            {{ wordCount }} {{ wordCount === 1 ? 'word' : 'words' }}
          </span>
          <span class="">
            {{ characterCount }} {{ characterCount === 1 ? 'character' : 'characters' }}
          </span>
          <span role="status" :title="notes.syncMessage">
            <SignalSlashIcon v-if="!online" class="size-5 text-stone-400" />
            <ArrowPathIcon v-else-if="notes.syncing" class="size-5 text-blue-500" />
            <ExclamationCircleIcon
              v-else-if="notes.syncMessage !== 'Synced' && notes.syncMessage !== 'Pending' && notes.syncMessage !== 'Local only'"
              class="size-5 text-red-500" />
            <CloudArrowUpIcon v-else-if="notes.selectedNote?.syncState === 'pending'" class="size-5 text-amber-500" />
            <CheckCircleIcon v-else class="size-5 text-green-500" />
          </span>
        </footer>
      </article>
    </template>
  </main>
</template>
