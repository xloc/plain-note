import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import type { Change, Note, NoteRecord, Tombstone } from '../../../shared/note'
import { ApiConflict, deleteNote, getChanges, getNote, putNote } from '../api'
import {
  clearLocalData,
  getMeta,
  loadNotes,
  removeNote,
  saveNote as saveStoredNote,
  setMeta,
  type LocalNote,
} from '../db'

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<LocalNote[]>([])
  const selectedId = ref<string | null>(null)
  const ready = ref(false)
  const syncing = ref(false)
  const syncMessage = ref('Local only')
  let syncTimer: number | undefined

  function saveNote(note: LocalNote) {
    return saveStoredNote(toRaw(note))
  }

  const activeNotes = computed(() => notes.value
    .filter(note => !note.deleted || note.syncState === 'conflict')
    .sort((a, b) => b.updatedAt - a.updatedAt))
  const selectedNote = computed(() => notes.value.find(note => (
    note.id === selectedId.value && (!note.deleted || note.syncState === 'conflict')
  )))

  async function initialize() {
    notes.value = await loadNotes()
    selectedId.value = activeNotes.value[0]?.id ?? null
    if (!selectedId.value)
      await createNote()
    ready.value = true
    void sync()
  }

  async function createNote() {
    const now = Date.now()
    const note: LocalNote = {
      id: crypto.randomUUID(),
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
    notes.value.push(note)
    selectedId.value = note.id
    await saveNote(note)
    scheduleSync()
  }

  function updateSelected(update: { content: string }) {
    const note = selectedNote.value
    if (!note)
      return
    Object.assign(note, update, {
      revision: crypto.randomUUID(),
      updatedAt: Date.now(),
      syncState: 'pending',
      conflict: undefined,
    })
    void saveNote(note)
    scheduleSync()
  }

  async function deleteSelected() {
    const note = selectedNote.value
    if (!note)
      return
    if (note.baseRevision === null) {
      notes.value = notes.value.filter(candidate => candidate.id !== note.id)
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
    selectedId.value = activeNotes.value[0]?.id ?? null
    if (!selectedId.value)
      await createNote()
    scheduleSync()
  }

  function select(id: string) {
    selectedId.value = id
  }

  function scheduleSync() {
    window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => void sync(), 700)
  }

  async function resetLocalData() {
    if (syncing.value)
      return
    if (!navigator.onLine) {
      syncMessage.value = 'Go online to reset local data'
      return
    }

    window.clearTimeout(syncTimer)
    await clearLocalData()
    notes.value = []
    selectedId.value = null
    await sync()
    if (!selectedId.value && syncMessage.value === 'Synced')
      await createNote()
  }

  async function sync() {
    if (syncing.value || !navigator.onLine)
      return
    syncing.value = true
    syncMessage.value = 'Syncing'
    try {
      await pushPending()
      await pullChanges()
      syncMessage.value = 'Synced'
    }
    catch (error) {
      syncMessage.value = error instanceof Error ? error.message : 'Sync failed'
    }
    finally {
      syncing.value = false
    }
  }

  async function pushPending() {
    for (const candidate of [...notes.value]) {
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
          const current = notes.value.find(note => note.id === candidate.id)
          if (current?.revision === revision) {
            notes.value = notes.value.filter(note => note.id !== candidate.id)
            await removeNote(candidate.id)
          }
        }
        else {
          await putNote({ baseRevision: candidate.baseRevision, note: toNote(candidate) })
          const current = notes.value.find(note => note.id === candidate.id)
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
        const current = notes.value.find(note => note.id === candidate.id)
        if (current?.revision === revision) {
          current.syncState = 'conflict'
          current.conflict = error.current
          await saveNote(current)
        }
      }
    }
  }

  async function pullChanges() {
    let generation = String(await getMeta('generation') ?? '') || null
    let cursor = Number(await getMeta('cursor') ?? 0)
    let firstPage = true

    while (true) {
      const response = await getChanges(generation, cursor)
      if (response.reset && firstPage) {
        const serverIds = new Set(response.changes.map(change => change.id))
        const obsolete = notes.value.filter(note => note.syncState === 'synced' && !serverIds.has(note.id))
        for (const note of obsolete) {
          notes.value = notes.value.filter(candidate => candidate.id !== note.id)
          await removeNote(note.id)
        }
      }
      for (const change of response.changes)
        await applyChange(change)

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
    if (!selectedNote.value)
      selectedId.value = activeNotes.value[0]?.id ?? null
  }

  async function applyChange(change: Change) {
    const local = notes.value.find(note => note.id === change.id)
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
        notes.value = notes.value.filter(note => note.id !== change.id)
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
    notes.value = notes.value.filter(note => note.id !== change.id)
    notes.value.push(replacement)
    await saveNote(replacement)
  }

  async function acceptServer(id: string) {
    const local = notes.value.find(note => note.id === id)
    if (!local?.conflict)
      return
    if ('deleted' in local.conflict) {
      notes.value = notes.value.filter(note => note.id !== id)
      await removeNote(id)
      selectedId.value = activeNotes.value[0]?.id ?? null
    }
    else {
      const replacement = fromRemote(local.conflict)
      notes.value = notes.value.filter(note => note.id !== id)
      notes.value.push(replacement)
      await saveNote(replacement)
    }
  }

  async function keepLocal(id: string) {
    const local = notes.value.find(note => note.id === id)
    if (!local?.conflict)
      return
    local.baseRevision = local.conflict.revision
    local.revision = crypto.randomUUID()
    local.updatedAt = Date.now()
    local.syncState = 'pending'
    local.conflict = undefined
    await saveNote(local)
    scheduleSync()
  }

  return {
    notes,
    selectedId,
    ready,
    syncing,
    syncMessage,
    activeNotes,
    selectedNote,
    initialize,
    createNote,
    updateSelected,
    deleteSelected,
    select,
    scheduleSync,
    resetLocalData,
    sync,
    pushPending,
    pullChanges,
    applyChange,
    acceptServer,
    keepLocal,
  }
})

function toNote(note: LocalNote): Note {
  const {
    baseRevision: _baseRevision,
    deleted: _deleted,
    syncState: _syncState,
    conflict: _conflict,
    ...stored
  } = note
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
  return 'deleted' in record ? 'deleted note' : `“${noteTitle(record.content)}”`
}

export function noteTitle(content: string) {
  return noteHeading(content)?.[1].trim() || 'Untitled'
}

export function notePreview(content: string) {
  const heading = noteHeading(content)
  return (heading ? content.slice(heading[0].length) : content).replace(/\n+/g, ' ').trim().slice(0, 80)
}

function noteHeading(content: string) {
  return content.match(/^#\s+([^\n]*?)(?:\s+#+)?\s*(?=\n|$)/)
}
