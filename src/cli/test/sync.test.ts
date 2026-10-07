import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, test } from 'vite-plus/test'
import type {
  DeleteNoteRequest,
  Note,
  NoteRecord,
  NoteResource,
  SyncResponse,
  Tombstone,
} from '@plain-note/shared/note'
import { ApiError, type NoteApi } from '../src/api.ts'
import { newNote } from '../src/new.ts'
import { sync } from '../src/sync.ts'
import { withWorkspace, Workspace } from '../src/workspace.ts'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'plain-note-cli-'))
  directories.push(root)
  const workspace = new Workspace(root)
  await workspace.initialize()
  const api = new Cloud()
  return { root, workspace, api }
}

async function create(workspace: Workspace, content: string) {
  const path = await newNote(workspace)
  await writeFile(path, content)
  return Object.values(workspace.state.notes).find((local) => workspace.notePath(local.note.id) === path)!.note.id
}

function note(content: string): Note {
  return { id: randomUUID(), revision: randomUUID(), content, tags: [], resources: [], createdAt: 1, updatedAt: 1 }
}

class Cloud implements NoteApi {
  generation = 'generation-1'
  cursor = 0
  records = new Map<string, { record: NoteRecord; seq: number }>()
  files = new Map<string, Uint8Array>()
  beforePut?: (note: Note) => Promise<void>
  beforeDelete?: () => Promise<void>
  beforeGet?: () => Promise<void>
  beforeResource?: () => Promise<void>

  store(record: NoteRecord) {
    this.records.set(record.id, { record: structuredClone(record), seq: ++this.cursor })
    return record
  }

  edit(id: string, content: string) {
    const current = this.records.get(id)!.record as Note
    return this.store({ ...current, content, updatedAt: current.updatedAt + 1, revision: randomUUID() })
  }

  async changes(generation: string | null, after: number): Promise<SyncResponse> {
    const reset = generation !== this.generation
    return {
      generation: this.generation,
      reset,
      cursor: reset ? 0 : this.cursor,
      changes: [...this.records.values()]
        .filter(({ seq }) => reset || seq > after)
        .map(({ record, seq }) => ({
          id: record.id,
          revision: record.revision,
          updatedAt: record.updatedAt,
          seq,
          operation: 'deleted' in record ? 'delete' : 'put',
        })),
    }
  }

  async get(id: string) {
    const current = this.records.get(id)?.record
    if (!current) throw new ApiError(404, 'not_found')
    const result = structuredClone(current)
    await this.beforeGet?.()
    return result
  }

  async put(note: Note, baseRevision: string | null) {
    await this.beforePut?.(note)
    const current = this.records.get(note.id)?.record
    if (current?.revision === note.revision) return current as Note
    if ((current?.revision ?? null) !== baseRevision) {
      throw current ? new ApiError(409, 'conflict', structuredClone(current)) : new ApiError(404, 'not_found')
    }
    this.store(note)
    return structuredClone(note)
  }

  async delete(id: string, body: DeleteNoteRequest): Promise<Tombstone> {
    await this.beforeDelete?.()
    const current = this.records.get(id)?.record
    if (!current) throw new ApiError(404, 'not_found')
    if (current.revision === body.revision) return current as Tombstone
    if (current.revision !== body.baseRevision) throw new ApiError(409, 'conflict', structuredClone(current))
    const tombstone: Tombstone = { id, deleted: true, revision: body.revision, updatedAt: body.updatedAt }
    this.store(tombstone)
    return tombstone
  }

  async resource(noteId: string, resource: NoteResource) {
    await this.beforeResource?.()
    const bytes = this.files.get(`${noteId}/${resource.id}`)
    if (!bytes) throw new ApiError(404, 'not_found')
    return bytes
  }

  async restoreResource(noteId: string, resource: NoteResource, bytes: Uint8Array) {
    this.files.set(`${noteId}/${resource.id}`, bytes)
  }
}

test('creates offline, uploads exact Markdown, and does not rewrite unchanged files', async () => {
  const { workspace, api } = await fixture()
  const content = '---\r\ncustom: yes\r\n---\r\n\r\n![x](resource:existing-id)  \r\n'
  const id = await create(workspace, content)
  const before = await stat(workspace.notePath(id))
  await sync(workspace, api)
  expect((api.records.get(id)!.record as Note).content).toBe(content)
  expect(await readFile(workspace.notePath(id), 'utf8')).toBe(content)
  const revision = workspace.state.notes[id]!.note.revision
  await sync(workspace, api)
  expect(workspace.state.notes[id]!.note.revision).toBe(revision)
  expect((await stat(workspace.notePath(id))).mtimeMs).toBe(before.mtimeMs)
  const loaded = new Workspace(workspace.root)
  await loaded.load()
  expect(loaded.state).toEqual(workspace.state)
})

test('downloads notes and read-only attachments without rewriting resource links', async () => {
  const { workspace, api } = await fixture()
  const remote = note('![photo](resource:photo)\n')
  remote.resources = [{ id: 'photo', name: 'photo.png', mime: 'image/png', size: 3, createdAt: 1 }]
  api.files.set(`${remote.id}/photo`, new Uint8Array([1, 2, 3]))
  api.store(remote)
  await sync(workspace, api)
  expect(await readFile(workspace.notePath(remote.id), 'utf8')).toBe(remote.content)
  expect([...(await readFile(workspace.resourcePath(remote.id, 'photo')))]).toEqual([1, 2, 3])
  expect((await stat(workspace.resourcePath(remote.id, 'photo'))).mode & 0o222).toBe(0)
  await rm(workspace.resourcePath(remote.id, 'photo'))
  await sync(workspace, api)
  expect([...(await readFile(workspace.resourcePath(remote.id, 'photo')))]).toEqual([1, 2, 3])
  api.store({ ...remote, resources: [], content: '', revision: randomUUID() })
  await sync(workspace, api)
  await expect(stat(workspace.resourcePath(remote.id, 'photo'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('merges independent and overlapping edits and uploads the result in the same run', async () => {
  const { workspace, api } = await fixture()
  const id = await create(workspace, 'A\n\nB\n\nC')
  await sync(workspace, api)
  api.edit(id, 'Remote A\n\nB\n\nC')
  await writeFile(workspace.notePath(id), 'A\n\nB\n\nLocal C')
  await sync(workspace, api)
  expect(await readFile(workspace.notePath(id), 'utf8')).toBe('Remote A\n\nB\n\nLocal C')
  api.edit(id, 'Remote conflict')
  await writeFile(workspace.notePath(id), 'Local conflict')
  await sync(workspace, api)
  const merged = await readFile(workspace.notePath(id), 'utf8')
  expect(merged).toContain('Remote conflict')
  expect(merged).toContain('Local conflict')
  expect(merged).toContain('---')
  expect((api.records.get(id)!.record as Note).content).toBe(merged)
})

test('synchronizes folder deletions in both directions and rejects a missing note.md', async () => {
  const { workspace, api } = await fixture()
  const id = await create(workspace, 'Delete me')
  await sync(workspace, api)
  await rm(workspace.notePath(id))
  await expect(sync(workspace, api)).rejects.toThrow('Delete the entire folder')
  await rm(workspace.noteDirectory(id), { recursive: true })
  await sync(workspace, api)
  expect(api.records.get(id)!.record).toHaveProperty('deleted', true)
  const remote = note('Remote deletion')
  api.store(remote)
  await sync(workspace, api)
  await api.delete(remote.id, { baseRevision: remote.revision, revision: randomUUID(), updatedAt: 2 })
  await sync(workspace, api)
  expect(await workspace.content(remote.id)).toBeNull()
})

test('preserves an edit when the other device deletes the note', async () => {
  const { workspace, api } = await fixture()
  const id = await create(workspace, 'Base')
  await sync(workspace, api)
  const base = workspace.state.notes[id]!.note
  await api.delete(id, { baseRevision: base.revision, revision: randomUUID(), updatedAt: base.updatedAt + 1 })
  await writeFile(workspace.notePath(id), 'Local survives')
  await sync(workspace, api)
  expect((api.records.get(id)!.record as Note).content).toBe('Local survives')
  await rm(workspace.noteDirectory(id), { recursive: true })
  api.edit(id, 'Remote survives')
  await sync(workspace, api)
  expect(await workspace.content(id)).toBe('Remote survives')
})

test('preserves edits during upload and deletion during initial upload', async () => {
  const { workspace, api } = await fixture()
  const id = await create(workspace, 'First version')
  api.beforePut = async () => {
    api.beforePut = undefined
    await writeFile(workspace.notePath(id), 'Edited during upload')
  }
  await sync(workspace, api)
  expect((api.records.get(id)!.record as Note).content).toBe('Edited during upload')
  const second = await create(workspace, 'Deleted during upload')
  api.beforePut = async () => {
    api.beforePut = undefined
    await rm(workspace.noteDirectory(second), { recursive: true })
  }
  await sync(workspace, api)
  expect(api.records.get(second)!.record).toHaveProperty('deleted', true)
})

test('merges a local save made while downloading a remote note', async () => {
  const { workspace, api } = await fixture()
  const id = await create(workspace, 'A\n\nB')
  await sync(workspace, api)
  api.edit(id, 'Remote A\n\nB')
  api.beforeGet = async () => {
    api.beforeGet = undefined
    await writeFile(workspace.notePath(id), 'A\n\nLocal B')
  }
  await sync(workspace, api)
  expect(await workspace.content(id)).toBe('Remote A\n\nLocal B')
  expect((api.records.get(id)!.record as Note).content).toBe('Remote A\n\nLocal B')
})

test('retries a lost upload response with the same revision', async () => {
  const { workspace, api } = await fixture()
  const id = await create(workspace, 'Committed')
  api.beforePut = async (sent) => {
    api.beforePut = undefined
    api.store(sent)
    throw new Error('Connection lost')
  }
  await expect(sync(workspace, api)).rejects.toThrow('Connection lost')
  const revision = workspace.state.notes[id]!.note.revision
  await workspace.load()
  await sync(workspace, api)
  expect(workspace.state.notes[id]!.base?.revision).toBe(revision)
  expect(api.cursor).toBe(1)
})

test('an index reset preserves local identities and does not imply deletion', async () => {
  const { workspace, api } = await fixture()
  const id = await create(workspace, 'Local copy')
  await sync(workspace, api)
  api.records.clear()
  api.generation = 'generation-2'
  api.cursor = 0
  await sync(workspace, api)
  expect((api.records.get(id)!.record as Note).content).toBe('Local copy')
})

test('failed attachment download does not advance the cursor or leave a partial note folder', async () => {
  const { workspace, api } = await fixture()
  const remote = note('![x](resource:missing)')
  remote.resources = [{ id: 'missing', name: 'x', mime: 'image/png', size: 1, createdAt: 1 }]
  api.store(remote)
  await expect(sync(workspace, api)).rejects.toThrow('not_found')
  expect(workspace.state.cursor).toBe(0)
  expect(await workspace.content(remote.id)).toBeNull()
  api.files.set(`${remote.id}/missing`, new Uint8Array([1]))
  await sync(workspace, api)
  expect(await workspace.content(remote.id)).toBe(remote.content)
})

test('commands lock the workspace and keep credentials private', async () => {
  const { root } = await fixture()
  await withWorkspace(root, async (workspace) => {
    await expect(withWorkspace(root, async () => {})).rejects.toThrow('Another command')
    await workspace.saveConfig({
      server: 'https://example.com',
      recoveryKey: 'secret',
      token: 'token',
      clientKey: 'client',
    })
    expect((await stat(join(workspace.metadata, 'config.yaml'))).mode & 0o777).toBe(0o600)
  })
  await withWorkspace(root, async (workspace) => expect((await workspace.config())!.token).toBe('token'))
})

test('restores original attachments with a resurrected note but refuses modified local bytes', async () => {
  const { workspace, api } = await fixture()
  const remote = note('![x](resource:photo)')
  remote.resources = [{ id: 'photo', name: 'photo.png', mime: 'image/png', size: 3, createdAt: 1 }]
  api.store(remote)
  api.files.set(`${remote.id}/photo`, new Uint8Array([1, 2, 3]))
  await sync(workspace, api)
  const removeCloudCopy = async () => {
    const current = api.records.get(remote.id)!.record
    await api.delete(remote.id, {
      baseRevision: current.revision,
      revision: randomUUID(),
      updatedAt: current.updatedAt + 1,
    })
    api.files.delete(`${remote.id}/photo`)
  }
  await removeCloudCopy()
  await writeFile(workspace.notePath(remote.id), `${remote.content}\n\nLocal edit`)
  await sync(workspace, api)
  expect([...api.files.get(`${remote.id}/photo`)!]).toEqual([1, 2, 3])
  expect((api.records.get(remote.id)!.record as Note).content).toContain('Local edit')

  await removeCloudCopy()
  await writeFile(workspace.notePath(remote.id), `${remote.content}\n\nAnother edit`)
  await chmod(workspace.resourcePath(remote.id, 'photo'), 0o600)
  await writeFile(workspace.resourcePath(remote.id, 'photo'), new Uint8Array([9, 9, 9]))
  await expect(sync(workspace, api)).rejects.toThrow('Cannot restore modified attachment')
  expect(api.files.has(`${remote.id}/photo`)).toBe(false)
  expect(api.records.get(remote.id)!.record).toHaveProperty('deleted', true)
  expect(await workspace.content(remote.id)).toContain('Another edit')
})
