<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
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
  <main class="flex min-h-screen">
    <aside class="flex w-64 flex-col overflow-auto bg-stone-200">
      <header class="flex m-2 gap-2 flex-wrap">
        <button class="bg-violet-500 text-white px-2 py-1 rounded-lg" type="button" @click="notes.createNote">
          New
        </button>
        <button class="bg-violet-500 text-white px-2 py-1 rounded-lg"
          v-if="notes.selectedNote && !notes.selectedNote.deleted" type="button" @click="notes.deleteSelected">
          Delete
        </button>
        <button class="bg-violet-500 text-white px-2 py-1 rounded-lg" type="button" :disabled="notes.syncing"
          @click="notes.sync">
          {{ notes.syncMessage }}
        </button>

      </header>

      <template v-if="notes.ready">
        <nav class="flex flex-col items-stretch">
          <button class=" hover:bg-violet-100 p-2 text-start" v-for="note in notes.activeNotes" :key="note.id"
            type="button" @click="notes.select(note.id)">
            <div class="w-full flex">
              <div class="shrink overflow-hidden text-ellipsis text-stone-800 font-semibold">
                {{ noteTitle(note.content) }}
              </div>
              <div class="flex-none" v-if="note.syncState !== 'synced'">({{ note.syncState }})</div>
            </div>
            <p class="line-clamp-1 h-5 leading-5 text-sm text-stone-800">{{ notePreview(note.content) }}
            </p>
          </button>
        </nav>


      </template>
    </aside>

    <template v-if="notes.ready">
      <article v-if="notes.selectedNote">
        <textarea rows="20" :value="notes.selectedNote.content"
          @input="notes.updateSelected({ content: ($event.target as HTMLTextAreaElement).value })" />


        <p v-if="notes.selectedNote.conflict">
          This note conflicts with {{ recordLabel(notes.selectedNote.conflict) }} on the server.
          <button type="button" @click="notes.acceptServer(notes.selectedNote.id)">
            Use server version
          </button>
          <button type="button" @click="notes.keepLocal(notes.selectedNote.id)">
            Keep this version
          </button>
        </p>
      </article>
    </template>
  </main>
</template>
