import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import type { Note } from '../../shared/note'
import * as api from '../src/api'
import * as db from '../src/db'
import { useNotesStore } from '../src/stores/notes'

vi.mock('@vueuse/core', async () => {
  const { ref } = await import('vue')
  return { useStorage: (_key: string, initial: unknown) => ref(initial) }
})

vi.mock('../src/api', () => ({
  ApiConflict: class extends Error {},
  ApiNotFound: class extends Error {},
  deleteNote: vi.fn(),
  getChanges: vi.fn(),
  getNote: vi.fn(),
  getResource: vi.fn(),
  putNote: vi.fn(),
  putResource: vi.fn(),
}))

vi.mock('../src/db', () => ({
  getMeta: vi.fn(),
  getResource: vi.fn(),
  loadResources: vi.fn(),
  removeNote: vi.fn(),
  removeNoteResources: vi.fn(),
  removeResource: vi.fn(),
  saveNote: vi.fn(),
  saveResource: vi.fn(),
  setMeta: vi.fn(),
}))

const base: Note = {
  id: 'note-id',
  content: 'Base',
  tags: [],
  resources: [],
  createdAt: 1,
  updatedAt: 1,
  revision: 'base-revision',
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vi.mocked(db.getMeta).mockResolvedValue(undefined)
  vi.mocked(db.loadResources).mockResolvedValue([])
})

afterEach(() => vi.restoreAllMocks())

test('merges an edit made while a remote note is loading', async () => {
  const remote: Note = { ...base, content: 'Remote edit', updatedAt: 2, revision: 'remote-revision' }
  let remoteRequested!: () => void
  let resolveRemote!: (value: { note: Note }) => void
  const requested = new Promise<void>((resolve) => (remoteRequested = resolve))
  const response = new Promise<{ note: Note }>((resolve) => (resolveRemote = resolve))

  vi.mocked(api.getChanges).mockResolvedValue({
    generation: 'generation',
    reset: false,
    cursor: 1,
    changes: [{ seq: 1, id: base.id, revision: remote.revision, updatedAt: remote.updatedAt, operation: 'put' }],
  })
  vi.mocked(api.getNote).mockImplementation(() => {
    remoteRequested()
    return response
  })

  const notes = useNotesStore()
  notes.notes.push({ ...base, base: { ...base }, deleted: false, syncState: 'synced' })
  notes.selectedId = base.id

  const syncing = notes.sync()
  await requested
  notes.updateSelected({ content: 'Local edit' })
  resolveRemote({ note: remote })
  await syncing

  expect(notes.selectedNote?.content).toContain('Remote edit')
  expect(notes.selectedNote?.content).toContain('Local edit')
  expect(notes.selectedNote?.syncState).toBe('pending')
})

test('keeps the update time monotonic when the device clock moves backwards', () => {
  vi.spyOn(Date, 'now').mockReturnValue(0)
  const notes = useNotesStore()
  notes.notes.push({ ...base, base: { ...base }, deleted: false, syncState: 'synced' })
  notes.selectedId = base.id

  notes.updateSelected({ content: 'Later edit' })

  expect(notes.selectedNote?.updatedAt).toBe(base.updatedAt + 1)
})

test('restores attachment metadata when an editor deletion is undone', async () => {
  const resource = { id: 'resource-id', name: 'file.txt', mime: 'text/plain', size: 4, createdAt: 1 }
  const content = '[file.txt](resource:resource-id)'
  const note = { ...base, content, resources: [resource] }
  const notes = useNotesStore()
  notes.notes.push({ ...note, base: { ...note }, deleted: false, syncState: 'synced' })
  notes.selectedId = note.id

  await notes.updateSelected({ content: '' })
  expect(notes.selectedNote?.resources).toEqual([])
  await notes.updateSelected({ content })

  expect(notes.selectedNote?.resources).toEqual([resource])
  expect(db.getResource).toHaveBeenCalledWith(note.id, resource.id)
})

test('lets the user cancel a cloud rebuild when an attachment is missing locally', async () => {
  const resource = { id: 'resource-id', name: 'only-in-cloud.txt', mime: 'text/plain', size: 4, createdAt: 1 }
  const note = { ...base, resources: [resource] }
  const notes = useNotesStore()
  notes.notes.push({ ...note, base: { ...note }, deleted: false, syncState: 'synced' })
  vi.mocked(db.getResource).mockResolvedValue(undefined)
  const confirmMissing = vi.fn(() => false)

  await expect(notes.prepareCloudRebuild(confirmMissing)).resolves.toBe(false)
  expect(confirmMissing).toHaveBeenCalledWith(['only-in-cloud.txt'])
  expect(notes.notes[0]?.resources).toEqual([resource])
  expect(db.saveNote).not.toHaveBeenCalled()
})

test('continues a cloud rebuild without attachments missing from this device', async () => {
  const resource = { id: 'resource-id', name: 'only-in-cloud.txt', mime: 'text/plain', size: 4, createdAt: 1 }
  const note = { ...base, resources: [resource] }
  const notes = useNotesStore()
  notes.notes.push({ ...note, base: { ...note }, deleted: false, syncState: 'synced' })
  vi.mocked(db.getResource).mockResolvedValue(undefined)
  vi.mocked(api.putNote).mockResolvedValue({ note: { ...note, resources: [] } })

  await expect(notes.prepareCloudRebuild(() => true)).resolves.toBe(true)
  await notes.uploadCloudRebuild()

  expect(notes.notes[0]?.resources).toEqual([])
  expect(db.saveNote).toHaveBeenCalledWith(expect.objectContaining({ resources: [], syncState: 'pending' }))
  expect(api.putNote).toHaveBeenCalledWith({ baseRevision: null, note: { ...note, resources: [] } })
  expect(api.getResource).not.toHaveBeenCalled()
})

test('uploads a cloud rebuild without pulling server records', async () => {
  const notes = useNotesStore()
  notes.notes.push({ ...base, base: { ...base }, deleted: false, syncState: 'synced' })
  vi.mocked(api.putNote).mockResolvedValue({ note: base })

  await notes.prepareCloudRebuild(() => true)
  await notes.uploadCloudRebuild()

  expect(api.putNote).toHaveBeenCalledWith({ baseRevision: null, note: base })
  expect(api.getChanges).not.toHaveBeenCalled()
  expect(notes.selectedNote?.syncState ?? notes.notes[0]?.syncState).toBe('synced')
})
