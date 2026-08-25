<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import NoteEditor from './components/NoteEditor.vue'
import { notePreview, noteTitle, recordLabel, useNotesStore } from './stores/notes'

const notes = useNotesStore()
const sync = () => void notes.sync()

onMounted(() => {
  void notes.initialize()
  window.addEventListener('online', sync)
})
onUnmounted(() => window.removeEventListener('online', sync))
</script>

<template>
  <main class="flex h-screen overflow-hidden">
    <aside class="flex w-64 shrink-0 flex-col bg-stone-200">
      <header class="m-2 flex flex-wrap gap-2">
        <button class="rounded-lg bg-violet-500 px-2 py-1 text-white" type="button" @click="notes.createNote">
          New
        </button>
        <button class="rounded-lg bg-violet-500 px-2 py-1 text-white"
          v-if="notes.selectedNote && !notes.selectedNote.deleted" type="button" @click="notes.deleteSelected">
          Delete
        </button>
        <button class="rounded-lg bg-violet-500 px-2 py-1 text-white" type="button" :disabled="notes.syncing"
          @click="notes.sync">
          {{ notes.syncMessage }}
        </button>

      </header>

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
      <article class="flex min-w-0 flex-1 flex-col" v-if="notes.selectedNote">
        <NoteEditor class="min-h-0 flex-1 overflow-auto" :model-value="notes.selectedNote.content"
          @update:model-value="notes.updateSelected({ content: $event })" />


        <div v-if="notes.selectedNote.conflict">
          This note conflicts with {{ recordLabel(notes.selectedNote.conflict) }} on the server.
          <button type="button" @click="notes.acceptServer(notes.selectedNote.id)">
            Use server version
          </button>
          <button type="button" @click="notes.keepLocal(notes.selectedNote.id)">
            Keep this version
          </button>
        </div>
      </article>
    </template>
  </main>
</template>
