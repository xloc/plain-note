import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { v4 as randomUUID } from 'uuid'
import { computed, ref, toRaw } from 'vue'
import type { Change, Note, NoteRecord, Tombstone } from '../../../shared/note'
import { ApiConflict, deleteNote, getChanges, getNote, putNote } from '../api'
import {
  clearLocalData,
  getMeta,
  loadNotes,
  removeNote as removeStoredNote,
  saveNote as saveStoredNote,
  setMeta,
  type LocalNote,
} from '../db'
import { mergeMarkdown } from '../editor/merge'
import { copyNote, copyRecord, fromRemote, toNote } from './noteRecords'

type NewNote = Pick<Note, 'content' | 'tags' | 'resources' | 'createdAt' | 'updatedAt'>

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<LocalNote[]>([])
  const selectedId = useStorage<string | null>('plain-note:selected-note-id', null)
  const ready = ref(false)
  const syncing = ref(false)
  const syncMessage = ref('Local only')
  let syncTimer: number | undefined

  const activeNotes = computed(() =>
    notes.value.filter((note) => !note.deleted).sort((a, b) => b.updatedAt - a.updatedAt),
  )
  const selectedNote = computed(() => notes.value.find((note) => note.id === selectedId.value && !note.deleted))

  function saveNote(note: LocalNote) {
    return saveStoredNote(toRaw(note))
  }

  async function addNote(source: NewNote) {
    const note: LocalNote = {
      ...source,
      id: randomUUID(),
      tags: [...source.tags],
      resources: source.resources.map((resource) => ({ ...resource })),
      revision: randomUUID(),
      base: null,
      deleted: false,
      syncState: 'pending',
    }
    notes.value.push(note)
    selectedId.value = note.id
    await saveNote(note)
    scheduleSync()
  }

  async function removeLocalNote(id: string) {
    notes.value = notes.value.filter((note) => note.id !== id)
    await removeStoredNote(id)
  }

  async function replaceLocalNote(note: LocalNote) {
    notes.value = notes.value.filter((candidate) => candidate.id !== note.id)
    notes.value.push(note)
    await saveNote(note)
  }

  function selectFirstNote() {
    selectedId.value = activeNotes.value[0]?.id ?? null
  }

  async function initialize(preferredId?: string) {
    if (ready.value) {
      if (preferredId && activeNotes.value.some((note) => note.id === preferredId)) selectedId.value = preferredId
      return
    }

    notes.value = await loadNotes()
    if (preferredId) {
      selectedId.value = preferredId
    } else if (!selectedNote.value) {
      selectFirstNote()
    }
    ready.value = true
    if (!selectedNote.value && navigator.onLine) {
      await sync()
    }
    if (!selectedNote.value) {
      selectFirstNote()
    }
    if (!selectedId.value) {
      await createNote()
    } else if (syncMessage.value === 'Local only') {
      void sync()
    }
  }

  async function createNote() {
    const now = Date.now()
    await addNote({
      content: '',
      tags: [],
      resources: [],
      createdAt: now,
      updatedAt: now,
    })
  }

  async function importNote(imported: NewNote) {
    await addNote(imported)
  }

  function updateSelected(update: { content: string }) {
    const note = selectedNote.value
    if (!note) return
    Object.assign(note, update, {
      revision: randomUUID(),
      updatedAt: Date.now(),
      syncState: 'pending',
    })
    void saveNote(note)
    scheduleSync()
  }

  async function deleteSelected() {
    const note = selectedNote.value
    if (!note || note.deleted) return
    if (note.base === null) {
      await removeLocalNote(note.id)
    } else {
      Object.assign(note, {
        deleted: true,
        revision: randomUUID(),
        updatedAt: Date.now(),
        syncState: 'pending',
      })
      await saveNote(note)
    }
    selectFirstNote()
    if (!selectedId.value) {
      await createNote()
    }
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
    if (syncing.value) return
    if (!navigator.onLine) {
      syncMessage.value = 'Go online to reset local data'
      return
    }

    window.clearTimeout(syncTimer)
    await clearLocalData()
    notes.value = []
    selectedId.value = null
    await sync()
    if (!selectedId.value && syncMessage.value === 'Synced') {
      await createNote()
    }
  }

  async function sync() {
    if (syncing.value || !navigator.onLine) return
    syncing.value = true
    syncMessage.value = 'Syncing'
    try {
      await pushPending()
      await pullChanges()
      if (notes.value.some((note) => note.syncState === 'pending')) {
        syncMessage.value = 'Pending'
        scheduleSync()
      } else {
        syncMessage.value = 'Synced'
      }
    } catch (error) {
      syncMessage.value = error instanceof Error ? error.message : 'Sync failed'
    } finally {
      syncing.value = false
    }
  }

  async function pushPending() {
    for (const id of notes.value.filter((note) => note.syncState === 'pending').map((note) => note.id)) {
      let conflicts = 0
      while (conflicts < 2) {
        const candidate = notes.value.find((note) => note.id === id)
        if (!candidate || candidate.syncState !== 'pending') break

        const revision = candidate.revision
        try {
          if (candidate.deleted) {
            if (!candidate.base) {
              throw new Error('A server-backed note is missing its base snapshot')
            }

            const { tombstone } = await deleteNote(candidate.id, {
              baseRevision: candidate.base.revision,
              revision,
              updatedAt: candidate.updatedAt,
            })
            const current = notes.value.find((note) => note.id === candidate.id)
            if (current?.revision === revision) {
              await removeLocalNote(candidate.id)
            } else if (current) {
              current.base = copyRecord(tombstone)
              await saveNote(current)
            }
          } else {
            const sent = toNote(candidate)
            const { note: stored } = await putNote({
              baseRevision: candidate.base?.revision ?? null,
              note: sent,
            })
            const current = notes.value.find((note) => note.id === candidate.id)
            if (current) {
              current.base = copyNote(stored)
              if (current.revision === revision) {
                current.syncState = 'synced'
              }
              await saveNote(current)
            }
          }
          break
        } catch (error) {
          if (!(error instanceof ApiConflict)) throw error

          const current = notes.value.find((note) => note.id === candidate.id)
          if (!current) break
          await mergeConflict(current, error.current)
          conflicts++
        }
      }
    }
  }

  async function pullChanges() {
    let generation = String((await getMeta('generation')) ?? '') || null
    let cursor = Number((await getMeta('cursor')) ?? 0)
    let firstPage = true

    while (true) {
      const response = await getChanges(generation, cursor)
      if (response.reset && firstPage) {
        const serverIds = new Set(response.changes.map((change) => change.id))
        const obsolete = notes.value.filter((note) => note.syncState === 'synced' && !serverIds.has(note.id))
        for (const note of obsolete) {
          await removeLocalNote(note.id)
        }
      }
      for (const change of response.changes) {
        await applyChange(change)
      }

      generation = response.generation
      cursor = response.cursor
      await setMeta('generation', generation)
      await setMeta('cursor', cursor)

      if (response.reset) {
        firstPage = false
        continue
      }
      if (response.changes.length < 500) break
      firstPage = false
    }
    if (!selectedNote.value) {
      selectFirstNote()
    }
  }

  async function applyChange(change: Change) {
    const local = notes.value.find((note) => note.id === change.id)
    if (change.operation === 'delete') {
      if (!local) return

      const tombstone: Tombstone = {
        id: change.id,
        deleted: true,
        revision: change.revision,
        updatedAt: change.updatedAt,
      }
      if (local.revision === change.revision || local.syncState === 'synced' || local.deleted) {
        await removeLocalNote(change.id)
      } else if (local.base?.revision !== change.revision) {
        await mergeConflict(local, tombstone)
      }
      return
    }

    if (local?.revision === change.revision) {
      if (local.syncState === 'pending') {
        local.base = toNote(local)
        local.syncState = 'synced'
        await saveNote(local)
      }
      return
    }

    if (local?.syncState === 'pending') {
      if (local.base?.revision === change.revision) return
      await mergeConflict(local, (await getNote(change.id)).note)
      return
    }

    const remote = (await getNote(change.id)).note
    await replaceLocalNote(fromRemote(remote))
  }

  async function mergeConflict(local: LocalNote, remote: NoteRecord) {
    if (!local.base) {
      throw new Error('A server-backed note is missing its base snapshot')
    }

    if ('deleted' in remote) {
      if (local.deleted) {
        await removeLocalNote(local.id)
        return
      }

      local.base = copyRecord(remote)
      local.revision = randomUUID()
      local.updatedAt = Date.now()
      local.syncState = 'pending'
      await saveNote(local)
      return
    }

    if (local.deleted) {
      await replaceLocalNote(fromRemote(remote))
      return
    }

    local.content = mergeMarkdown('deleted' in local.base ? '' : local.base.content, remote.content, local.content)
    local.base = copyNote(remote)
    local.revision = randomUUID()
    local.updatedAt = Date.now()
    local.syncState = 'pending'
    await saveNote(local)
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
    importNote,
    updateSelected,
    deleteSelected,
    select,
    resetLocalData,
    sync,
  }
})
