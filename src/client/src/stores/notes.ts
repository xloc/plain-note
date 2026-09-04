import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { v4 as randomUUID } from 'uuid'
import { computed, ref, toRaw } from 'vue'
import type { Change, Note, NoteRecord, NoteResource, Tombstone } from '../../../shared/note'
import * as api from '../api'
import * as db from '../db'
import { referencedResourceIds } from '../editor/markdown'
import { mergeResources } from './mergeResources'
import { mergeMarkdown } from './mergeMarkdown'
import { copyNote, copyRecord, fromRemote, toNote } from './noteRecords'

type NewNote = Pick<Note, 'content' | 'tags' | 'resources' | 'createdAt' | 'updatedAt'>

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<db.LocalNote[]>([])
  const selectedId = useStorage<string | null>('plain-note:selected-note-id', null)
  const ready = ref(false)
  const syncing = ref(false)
  const syncMessage = ref('Local only')
  const syncRequest = ref(0)
  const resourceProgress = ref<Record<string, number>>({})

  const activeNotes = computed(() =>
    notes.value.filter((note) => !note.deleted).sort((a, b) => b.updatedAt - a.updatedAt),
  )
  const hasPending = computed(() => notes.value.some((note) => note.syncState === 'pending'))
  const selectedNote = computed(() => notes.value.find((note) => note.id === selectedId.value && !note.deleted))

  function saveNote(note: db.LocalNote) {
    return db.saveNote({
      ...toRaw(note),
      tags: [...note.tags],
      resources: note.resources.map((resource) => ({ ...resource })),
      base: note.base ? copyRecord(note.base) : null,
    })
  }

  function keepReferencedResources(note: db.LocalNote, content = note.content) {
    const referenced = referencedResourceIds(content)
    const resources = note.resources.filter((resource) => referenced.has(resource.id))
    if (resources.length === note.resources.length) return false
    for (const resource of note.resources) {
      if (!referenced.has(resource.id)) delete resourceProgress.value[resource.id]
    }
    note.resources = resources
    return true
  }

  async function addNote(source: NewNote) {
    const referenced = referencedResourceIds(source.content)
    const note: db.LocalNote = {
      ...source,
      id: randomUUID(),
      tags: [...source.tags],
      resources: source.resources
        .filter((resource) => referenced.has(resource.id))
        .map((resource) => ({ ...resource })),
      revision: randomUUID(),
      base: null,
      deleted: false,
      syncState: 'pending',
    }
    notes.value.push(note)
    selectedId.value = note.id
    await saveNote(note)
    notifyLocalChange()
  }

  async function removeLocalNote(id: string) {
    notes.value = notes.value.filter((note) => note.id !== id)
    await Promise.all([db.removeNote(id), db.removeNoteResources(id)])
  }

  async function replaceLocalNote(note: db.LocalNote) {
    if (!note.deleted && keepReferencedResources(note)) {
      Object.assign(note, {
        revision: randomUUID(),
        updatedAt: Date.now(),
        syncState: 'pending',
      })
    }
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

    notes.value = await db.loadNotes()
    for (const note of notes.value) {
      if (note.deleted || !keepReferencedResources(note)) continue
      Object.assign(note, {
        revision: randomUUID(),
        updatedAt: Date.now(),
        syncState: 'pending',
      })
      await saveNote(note)
    }
    if (preferredId) {
      selectedId.value = preferredId
    } else if (!selectedNote.value) {
      selectFirstNote()
    }
    ready.value = true
    if (!selectedNote.value) {
      selectFirstNote()
    }
    if (!selectedId.value) {
      await createNote()
    }
    notifyLocalChange()
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
    keepReferencedResources(note, update.content)
    Object.assign(note, update, {
      revision: randomUUID(),
      updatedAt: Date.now(),
      syncState: 'pending',
    })
    void saveNote(note)
    notifyLocalChange()
  }

  async function addResources(noteId: string, files: File[]) {
    const note = notes.value.find((candidate) => candidate.id === noteId && !candidate.deleted)
    if (!note) return

    const additions: NoteResource[] = []
    for (const file of files) {
      const resource: NoteResource = {
        id: randomUUID(),
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        createdAt: Date.now(),
      }
      additions.push(resource)
      await db.saveResource({
        ...resource,
        noteId: note.id,
        blob: file,
        syncState: 'pending',
      })
    }

    note.resources.push(...additions)
    Object.assign(note, {
      revision: randomUUID(),
      updatedAt: Date.now(),
      syncState: 'pending',
    })
    await saveNote(note)
    notifyLocalChange()
    return additions
  }

  async function removeResource(noteId: string, id: string) {
    const note = notes.value.find((candidate) => candidate.id === noteId && !candidate.deleted)
    if (!note?.resources.some((resource) => resource.id === id)) return
    note.resources = note.resources.filter((resource) => resource.id !== id)
    Object.assign(note, {
      revision: randomUUID(),
      updatedAt: Date.now(),
      syncState: 'pending',
    })
    delete resourceProgress.value[id]
    await saveNote(note)
    notifyLocalChange()
  }

  async function downloadResource(noteId: string, resource: NoteResource) {
    const blob = await getResourceBlob(noteId, resource)

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = resource.name
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url))
  }

  async function getResourceBlob(noteId: string, resource: NoteResource) {
    const local = await db.getResource(noteId, resource.id)
    if (local) return local.blob

    const blob = await api.getResource(noteId, resource)
    await db.saveResource({ ...resource, noteId, blob, syncState: 'synced' })
    return blob
  }

  async function deleteNote(id: string) {
    const note = notes.value.find((candidate) => candidate.id === id && !candidate.deleted)
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
    if (selectedId.value === note.id) {
      selectFirstNote()
      if (!selectedId.value) await createNote()
    }
    notifyLocalChange()
  }

  async function deleteSelected() {
    if (selectedId.value) await deleteNote(selectedId.value)
  }

  function select(id: string) {
    selectedId.value = id
  }

  function notifyLocalChange() {
    // Touch this value to trigger the cloud sync store's watcher; the value itself has no meaning.
    syncRequest.value++
  }

  async function resetLocalData() {
    await db.clearLocalData()
    notes.value = []
    selectedId.value = null
    syncMessage.value = 'Local only'
  }

  async function ensureNote() {
    if (!selectedNote.value) selectFirstNote()
    if (!selectedId.value) {
      await createNote()
    }
  }

  async function prepareCloudRebuild() {
    for (const note of notes.value.filter((note) => !note.deleted)) {
      note.syncState = 'pending'
      await markResourcesPending(note.id, note.resources)
      await saveNote(note)
    }
    notifyLocalChange()
  }

  async function sync() {
    if (syncing.value) return
    syncing.value = true
    syncMessage.value = 'Syncing'
    try {
      await pushPending()
      await pullChanges()
      await syncResources()
      if (notes.value.some((note) => note.syncState === 'pending')) {
        syncMessage.value = 'Pending'
        notifyLocalChange()
      } else {
        syncMessage.value = 'Synced'
      }
    } catch (error) {
      syncMessage.value = error instanceof Error ? error.message : 'Sync failed'
      throw error
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

            const { tombstone } = await api.deleteNote(candidate.id, {
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
            await pushResources(candidate.id, sent.resources)
            const baseRevision = candidate.base?.revision === revision ? null : (candidate.base?.revision ?? null)
            let stored: Note
            try {
              stored = (await api.putNote({ baseRevision, note: sent })).note
            } catch (error) {
              if (!(error instanceof api.ApiNotFound) || candidate.base === null) throw error
              stored = (await api.putNote({ baseRevision: null, note: sent })).note
            }
            const current = notes.value.find((note) => note.id === candidate.id)
            if (current) {
              await markResourcesSynced(candidate.id, sent.resources)
              current.base = copyNote(stored)
              if (current.revision === revision) {
                current.syncState = 'synced'
              }
              await saveNote(current)
            }
          }
          break
        } catch (error) {
          if (error instanceof api.ApiNotFound && candidate.deleted) {
            await removeLocalNote(candidate.id)
            break
          }
          if (!(error instanceof api.ApiConflict)) throw error

          const current = notes.value.find((note) => note.id === candidate.id)
          if (!current) break
          await mergeConflict(current, error.current)
          conflicts++
        }
      }
    }
  }

  async function pushResources(noteId: string, resources: NoteResource[]) {
    for (const resource of resources) {
      let local = await db.getResource(noteId, resource.id)
      if (!local) {
        const blob = await api.getResource(noteId, resource)
        local = { ...resource, noteId, blob, syncState: 'synced' }
        await db.saveResource(local)
      }
      if (local.syncState === 'pending') {
        resourceProgress.value[resource.id] = 0
        await api.putResource(noteId, resource, local.blob, (progress) => {
          resourceProgress.value[resource.id] = progress
        })
      }
    }
  }

  async function syncResources() {
    for (const note of notes.value.filter((note) => !note.deleted)) {
      const desired = new Set(note.resources.map((resource) => resource.id))
      for (const local of await db.loadResources(note.id)) {
        if (!desired.has(local.id)) {
          await db.removeResource(note.id, local.id)
        } else if (note.syncState === 'synced' && local.syncState === 'pending') {
          local.syncState = 'synced'
          await db.saveResource(local)
        }
      }
      for (const resource of note.resources) {
        if (await db.getResource(note.id, resource.id)) continue
        const blob = await api.getResource(note.id, resource)
        await db.saveResource({ ...resource, noteId: note.id, blob, syncState: 'synced' })
      }
    }
  }

  async function pullChanges() {
    let generation = String((await db.getMeta('generation')) ?? '') || null
    let cursor = Number((await db.getMeta('cursor')) ?? 0)
    let firstPage = true

    while (true) {
      const response = await api.getChanges(generation, cursor)
      if (response.reset && firstPage) {
        const serverIds = new Set(response.changes.map((change) => change.id))
        const missing = notes.value.filter((note) => note.syncState === 'synced' && !serverIds.has(note.id))
        for (const note of missing) {
          // A generation invalidates the sync cursor, not note identities. Restore local-only notes with the same UUID.
          note.syncState = 'pending'
          await markResourcesPending(note.id, note.resources)
          await saveNote(note)
        }
      }
      for (const change of response.changes) {
        await applyChange(change)
      }

      generation = response.generation
      cursor = response.cursor
      await db.setMeta('generation', generation)
      await db.setMeta('cursor', cursor)

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
      await mergeConflict(local, (await api.getNote(change.id)).note)
      return
    }

    const remote = (await api.getNote(change.id)).note
    await replaceLocalNote(fromRemote(remote))
  }

  async function mergeConflict(local: db.LocalNote, remote: NoteRecord) {
    if (!local.base) {
      throw new Error('A server-backed note is missing its base snapshot')
    }

    if ('deleted' in remote) {
      if (local.deleted) {
        await removeLocalNote(local.id)
        return
      }

      local.base = copyRecord(remote)
      await markResourcesPending(local.id, local.resources)
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
    local.resources = mergeResources(
      'deleted' in local.base ? [] : local.base.resources,
      remote.resources,
      local.resources,
    )
    keepReferencedResources(local, local.content)
    local.base = copyNote(remote)
    local.revision = randomUUID()
    local.updatedAt = Date.now()
    local.syncState = 'pending'
    await saveNote(local)
  }

  async function markResourcesPending(noteId: string, resources: NoteResource[]) {
    for (const resource of resources) {
      const local = await db.getResource(noteId, resource.id)
      if (!local) continue
      local.syncState = 'pending'
      await db.saveResource(local)
    }
  }

  async function markResourcesSynced(noteId: string, resources: NoteResource[]) {
    for (const resource of resources) {
      const local = await db.getResource(noteId, resource.id)
      if (!local) continue
      local.syncState = 'synced'
      await db.saveResource(local)
      delete resourceProgress.value[resource.id]
    }
  }

  return {
    notes,
    selectedId,
    ready,
    syncing,
    syncMessage,
    syncRequest,
    resourceProgress,
    activeNotes,
    hasPending,
    selectedNote,
    initialize,
    createNote,
    importNote,
    updateSelected,
    addResources,
    removeResource,
    downloadResource,
    getResourceBlob,
    deleteNote,
    deleteSelected,
    select,
    resetLocalData,
    ensureNote,
    prepareCloudRebuild,
    sync,
  }
})
