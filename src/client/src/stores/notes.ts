import { defineStore } from 'pinia'
import type { Change, Note, NoteRecord, Tombstone } from '../../../shared/note'
import { ApiConflict, deleteNote, getChanges, getNote, putNote } from '../api'
import {
  getMeta,
  loadNotes,
  removeNote,
  saveNote,
  setMeta,
  type LocalNote,
} from '../db'

let syncTimer: number | undefined

export const useNotesStore = defineStore('notes', {
  state: () => ({
    notes: [] as LocalNote[],
    selectedId: null as string | null,
    ready: false,
    syncing: false,
    syncMessage: 'Local only',
  }),

  getters: {
    activeNotes: state => state.notes
      .filter(note => !note.deleted || note.syncState === 'conflict')
      .sort((a, b) => b.updatedAt - a.updatedAt),
    selectedNote: state => state.notes.find(note => (
      note.id === state.selectedId && (!note.deleted || note.syncState === 'conflict')
    )),
  },

  actions: {
    async initialize() {
      this.notes = await loadNotes()
      this.selectedId = this.activeNotes[0]?.id ?? null
      if (!this.selectedId)
        await this.createNote()
      this.ready = true
      void this.sync()
    },

    async createNote() {
      const now = Date.now()
      const note: LocalNote = {
        id: crypto.randomUUID(),
        title: 'Untitled',
        content: '',
        tags: [],
        resources: [],
        createdAt: now,
        updatedAt: now,
        revision: crypto.randomUUID(),
        baseRevision: null,
        deleted: false,
        syncState: 'pending',
      }
      this.notes.push(note)
      this.selectedId = note.id
      await saveNote(note)
      this.scheduleSync()
    },

    updateSelected(update: { title?: string, content?: string }) {
      const note = this.selectedNote
      if (!note)
        return
      Object.assign(note, update, {
        revision: crypto.randomUUID(),
        updatedAt: Date.now(),
        syncState: 'pending',
        conflict: undefined,
      })
      void saveNote(note)
      this.scheduleSync()
    },

    async deleteSelected() {
      const note = this.selectedNote
      if (!note)
        return
      if (note.baseRevision === null) {
        this.notes = this.notes.filter(candidate => candidate.id !== note.id)
        await removeNote(note.id)
      }
      else {
        Object.assign(note, {
          deleted: true,
          revision: crypto.randomUUID(),
          updatedAt: Date.now(),
          syncState: 'pending',
          conflict: undefined,
        })
        await saveNote(note)
      }
      this.selectedId = this.activeNotes[0]?.id ?? null
      if (!this.selectedId)
        await this.createNote()
      this.scheduleSync()
    },

    select(id: string) {
      this.selectedId = id
    },

    scheduleSync() {
      window.clearTimeout(syncTimer)
      syncTimer = window.setTimeout(() => void this.sync(), 700)
    },

    async sync() {
      if (this.syncing || !navigator.onLine)
        return
      this.syncing = true
      this.syncMessage = 'Syncing'
      try {
        await this.pushPending()
        await this.pullChanges()
        this.syncMessage = 'Synced'
      }
      catch (error) {
        this.syncMessage = error instanceof Error ? error.message : 'Sync failed'
      }
      finally {
        this.syncing = false
      }
    },

    async pushPending() {
      for (const candidate of [...this.notes]) {
        if (candidate.syncState !== 'pending')
          continue
        const revision = candidate.revision
        try {
          if (candidate.deleted) {
            if (!candidate.baseRevision)
              continue
            await deleteNote(candidate.id, {
              baseRevision: candidate.baseRevision,
              revision,
              updatedAt: candidate.updatedAt,
            })
            const current = this.notes.find(note => note.id === candidate.id)
            if (current?.revision === revision) {
              this.notes = this.notes.filter(note => note.id !== candidate.id)
              await removeNote(candidate.id)
            }
          }
          else {
            await putNote({ baseRevision: candidate.baseRevision, note: toNote(candidate) })
            const current = this.notes.find(note => note.id === candidate.id)
            if (current?.revision === revision) {
              current.baseRevision = revision
              current.syncState = 'synced'
              await saveNote(current)
            }
          }
        }
        catch (error) {
          if (!(error instanceof ApiConflict))
            throw error
          const current = this.notes.find(note => note.id === candidate.id)
          if (current?.revision === revision) {
            current.syncState = 'conflict'
            current.conflict = error.current
            await saveNote(current)
          }
        }
      }
    },

    async pullChanges() {
      let generation = String(await getMeta('generation') ?? '') || null
      let cursor = Number(await getMeta('cursor') ?? 0)
      let firstPage = true

      while (true) {
        const response = await getChanges(generation, cursor)
        if (response.reset && firstPage) {
          const serverIds = new Set(response.changes.map(change => change.id))
          const obsolete = this.notes.filter(note => note.syncState === 'synced' && !serverIds.has(note.id))
          for (const note of obsolete) {
            this.notes = this.notes.filter(candidate => candidate.id !== note.id)
            await removeNote(note.id)
          }
        }
        for (const change of response.changes)
          await this.applyChange(change)

        generation = response.generation
        cursor = response.cursor
        await setMeta('generation', generation)
        await setMeta('cursor', cursor)

        if (response.reset) {
          firstPage = false
          continue
        }
        if (response.changes.length < 500)
          break
        firstPage = false
      }
      if (!this.selectedNote)
        this.selectedId = this.activeNotes[0]?.id ?? null
    },

    async applyChange(change: Change) {
      const local = this.notes.find(note => note.id === change.id)
      if (change.operation === 'delete') {
        const tombstone: Tombstone = {
          id: change.id,
          deleted: true,
          revision: change.revision,
          updatedAt: change.updatedAt,
        }
        if (local?.syncState === 'pending' && local.baseRevision !== change.revision) {
          local.syncState = 'conflict'
          local.conflict = tombstone
          await saveNote(local)
        }
        else if (local?.syncState === 'conflict') {
          local.conflict = tombstone
          await saveNote(local)
        }
        else if (local) {
          this.notes = this.notes.filter(note => note.id !== change.id)
          await removeNote(change.id)
        }
        return
      }

      if (local?.syncState === 'conflict') {
        if (local.conflict?.revision !== change.revision) {
          local.conflict = (await getNote(change.id)).note
          await saveNote(local)
        }
        return
      }
      if (local?.syncState === 'pending') {
        if (local.revision === change.revision) {
          local.baseRevision = change.revision
          local.syncState = 'synced'
          await saveNote(local)
        }
        else if (local.baseRevision !== change.revision) {
          local.syncState = 'conflict'
          local.conflict = (await getNote(change.id)).note
          await saveNote(local)
        }
        return
      }
      if (local?.revision === change.revision)
        return

      const remote = (await getNote(change.id)).note
      const replacement = fromRemote(remote)
      this.notes = this.notes.filter(note => note.id !== change.id)
      this.notes.push(replacement)
      await saveNote(replacement)
    },

    async acceptServer(id: string) {
      const local = this.notes.find(note => note.id === id)
      if (!local?.conflict)
        return
      if ('deleted' in local.conflict) {
        this.notes = this.notes.filter(note => note.id !== id)
        await removeNote(id)
        this.selectedId = this.activeNotes[0]?.id ?? null
      }
      else {
        const replacement = fromRemote(local.conflict)
        this.notes = this.notes.filter(note => note.id !== id)
        this.notes.push(replacement)
        await saveNote(replacement)
      }
    },

    async keepLocal(id: string) {
      const local = this.notes.find(note => note.id === id)
      if (!local?.conflict)
        return
      local.baseRevision = local.conflict.revision
      local.revision = crypto.randomUUID()
      local.updatedAt = Date.now()
      local.syncState = 'pending'
      local.conflict = undefined
      await saveNote(local)
      this.scheduleSync()
    },
  },
})

function toNote(note: LocalNote): Note {
  const { baseRevision: _baseRevision, deleted: _deleted, syncState: _syncState, conflict: _conflict, ...stored } = note
  return stored
}

function fromRemote(note: Note): LocalNote {
  return {
    ...note,
    baseRevision: note.revision,
    deleted: false,
    syncState: 'synced',
  }
}

export function recordLabel(record: NoteRecord) {
  return 'deleted' in record ? 'deleted note' : `“${record.title}”`
}
