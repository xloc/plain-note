import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { v4 as randomUUID } from 'uuid'
import { computed, ref, toRaw } from 'vue'
import type { Change, Note, NoteRecord, NoteResource, Tombstone } from '../../../shared/note'
import { referencedResourceIds } from '../editor/markdown'
import {
  ApiConflict,
  deleteNote,
  getChanges,
  getNote,
  getResource as getRemoteResource,
  putNote,
  putResource as putRemoteResource,
} from '../api'
import {
  clearLocalData,
  getMeta,
  getResource as getStoredResource,
  loadNotes,
  loadResources,
  removeNote as removeStoredNote,
  removeNoteResources,
  removeResource as removeStoredResource,
  saveNote as saveStoredNote,
  saveResource as saveStoredResource,
  setMeta,
  type LocalNote,
} from '../db'
import { mergeResources } from './mergeResources'
import { mergeMarkdown } from './mergeMarkdown'
import { copyNote, copyRecord, fromRemote, toNote } from './noteRecords'

type NewNote = Pick<Note, 'content' | 'tags' | 'resources' | 'createdAt' | 'updatedAt'>

export const useNotesStore = defineStore('notes', () => {
  const notes = ref<LocalNote[]>([])
  const selectedId = useStorage<string | null>('plain-note:selected-note-id', null)
  const ready = ref(false)
  const syncing = ref(false)
  const syncMessage = ref('Local only')
  const resourceProgress = ref<Record<string, number>>({})
  let syncTimer: number | undefined

  const activeNotes = computed(() =>
    notes.value.filter((note) => !note.deleted).sort((a, b) => b.updatedAt - a.updatedAt),
  )
  const selectedNote = computed(() => notes.value.find((note) => note.id === selectedId.value && !note.deleted))

  function saveNote(note: LocalNote) {
    return saveStoredNote({
      ...toRaw(note),
      tags: [...note.tags],
      resources: note.resources.map((resource) => ({ ...resource })),
      base: note.base ? copyRecord(note.base) : null,
    })
  }

  function keepReferencedResources(note: LocalNote, content = note.content) {
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
    const note: LocalNote = {
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
    scheduleSync()
  }

  async function removeLocalNote(id: string) {
    notes.value = notes.value.filter((note) => note.id !== id)
    await Promise.all([removeStoredNote(id), removeNoteResources(id)])
  }

  async function replaceLocalNote(note: LocalNote) {
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

    notes.value = await loadNotes()
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
    keepReferencedResources(note, update.content)
    Object.assign(note, update, {
      revision: randomUUID(),
      updatedAt: Date.now(),
      syncState: 'pending',
    })
    void saveNote(note)
    scheduleSync()
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
      await saveStoredResource({
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
    scheduleSync()
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
    scheduleSync()
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
    const local = await getStoredResource(noteId, resource.id)
    if (local) return local.blob

    const blob = await getRemoteResource(noteId, resource.id)
    await saveStoredResource({ ...resource, noteId, blob, syncState: 'synced' })
    return blob
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
      await syncResources()
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
            await pushResources(candidate.id, sent.resources)
            const { note: stored } = await putNote({
              baseRevision: candidate.base?.revision ?? null,
              note: sent,
            })
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
          if (!(error instanceof ApiConflict)) throw error

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
      let local = await getStoredResource(noteId, resource.id)
      if (!local) {
        const blob = await getRemoteResource(noteId, resource.id)
        local = { ...resource, noteId, blob, syncState: 'synced' }
        await saveStoredResource(local)
      }
      if (local.syncState === 'pending') {
        resourceProgress.value[resource.id] = 0
        await putRemoteResource(noteId, resource, local.blob, (progress) => {
          resourceProgress.value[resource.id] = progress
        })
      }
    }
  }

  async function syncResources() {
    for (const note of notes.value.filter((note) => !note.deleted)) {
      const desired = new Set(note.resources.map((resource) => resource.id))
      for (const local of await loadResources(note.id)) {
        if (!desired.has(local.id)) {
          await removeStoredResource(note.id, local.id)
        } else if (note.syncState === 'synced' && local.syncState === 'pending') {
          local.syncState = 'synced'
          await saveStoredResource(local)
        }
      }
      for (const resource of note.resources) {
        if (await getStoredResource(note.id, resource.id)) continue
        const blob = await getRemoteResource(note.id, resource.id)
        await saveStoredResource({ ...resource, noteId: note.id, blob, syncState: 'synced' })
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
      const local = await getStoredResource(noteId, resource.id)
      if (!local) continue
      local.syncState = 'pending'
      await saveStoredResource(local)
    }
  }

  async function markResourcesSynced(noteId: string, resources: NoteResource[]) {
    for (const resource of resources) {
      const local = await getStoredResource(noteId, resource.id)
      if (!local) continue
      local.syncState = 'synced'
      await saveStoredResource(local)
      delete resourceProgress.value[resource.id]
    }
  }

  return {
    notes,
    selectedId,
    ready,
    syncing,
    syncMessage,
    resourceProgress,
    activeNotes,
    selectedNote,
    initialize,
    createNote,
    importNote,
    updateSelected,
    addResources,
    removeResource,
    downloadResource,
    getResourceBlob,
    deleteSelected,
    select,
    resetLocalData,
    sync,
  }
})
