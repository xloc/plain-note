<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { recordLabel, useNotesStore } from './stores/notes'

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
    <aside class="flex w-64 flex-col overflow-auto">
      <header>
        <button type="button" @click="notes.createNote">
          New Note
        </button>
        <button type="button" :disabled="notes.syncing" @click="notes.sync">
          {{ notes.syncMessage }}
        </button>
      </header>

      <template v-if="notes.ready">
        <nav aria-label="Notes">
          <button v-for="note in notes.activeNotes" :key="note.id" type="button" @click="notes.select(note.id)">
            {{ note.title || 'Untitled' }}
            <small v-if="note.syncState !== 'synced'">({{ note.syncState }})</small>
          </button>
        </nav>

        <button v-if="notes.selectedNote && !notes.selectedNote.deleted" type="button" @click="notes.deleteSelected">
          Delete note
        </button>
      </template>
    </aside>

    <template v-if="notes.ready">
      <article v-if="notes.selectedNote">
        <label>
          Title
          <input :value="notes.selectedNote.title"
            @input="notes.updateSelected({ title: ($event.target as HTMLInputElement).value })">
        </label>

        <label>
          Markdown
          <textarea rows="20" :value="notes.selectedNote.content"
            @input="notes.updateSelected({ content: ($event.target as HTMLTextAreaElement).value })" />
        </label>

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
