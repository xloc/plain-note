import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { Note, NoteRecord } from '@plain-note/shared/note'

export type Config = { server: string; recoveryKey: string; token: string; clientKey: string }
export type LocalNote = {
  note: Note
  deleted: boolean
  base: NoteRecord | null
  resourceHashes: Record<string, string>
}
export type State = { generation: string | null; cursor: number; notes: Record<string, LocalNote> }

export class Workspace {
  state: State = { generation: null, cursor: 0, notes: {} }
  readonly metadata: string

  constructor(readonly root: string) {
    this.metadata = join(root, '.plain-note')
  }

  async initialize() {
    await regularPath(this.metadata, true)
    await mkdir(this.metadata, { recursive: true, mode: 0o700 })
    await atomicWrite(join(this.metadata, '.gitignore'), '*\n')
  }

  async load() {
    const source = await readOptional(join(this.metadata, 'state.json'))
    if (source !== null) this.state = JSON.parse(source) as State
  }

  async save() {
    await atomicWrite(join(this.metadata, 'state.json'), JSON.stringify(this.state, null, 2) + '\n')
  }

  async config() {
    const source = await readOptional(join(this.metadata, 'config.yaml'))
    return source === null ? null : (parse(source) as Config)
  }

  async saveConfig(config: Config) {
    await atomicWrite(join(this.metadata, 'config.yaml'), stringify(config))
  }

  noteDirectory(id: string) {
    return join(this.root, segment(id))
  }

  notePath(id: string) {
    return join(this.noteDirectory(id), 'note.md')
  }

  resourcePath(noteId: string, id: string) {
    return join(this.noteDirectory(noteId), 'resources', segment(id))
  }

  async content(id: string) {
    const directory = this.noteDirectory(id)
    if (!(await regularPath(directory, true))) return null
    const content = await readOptional(this.notePath(id))
    if (content === null) throw new Error(`${id}/note.md is missing. Delete the entire folder to delete a note.`)
    return content
  }

  async writeNote(note: Note) {
    await regularPath(this.noteDirectory(note.id), true)
    await regularPath(join(this.noteDirectory(note.id), 'resources'), true)
    await mkdir(join(this.noteDirectory(note.id), 'resources'), { recursive: true, mode: 0o700 })
    await atomicWrite(this.notePath(note.id), note.content)
  }

  async scan(id: string) {
    const local = this.state.notes[id]
    if (!local) return
    const content = await this.content(id)
    if (content === null && local.base === null) {
      delete this.state.notes[id]
      return
    }
    if (local.deleted === (content === null) && (content === null || local.note.content === content)) return
    local.deleted = content === null
    local.note = {
      ...local.note,
      content: content ?? local.note.content,
      revision: randomUUID(),
      updatedAt: Math.max(Date.now(), local.note.updatedAt + 1),
    }
  }
}

export async function withWorkspace<T>(root: string, operation: (workspace: Workspace) => Promise<T>) {
  const workspace = new Workspace(root)
  await workspace.initialize()
  const lockPath = join(workspace.metadata, 'lock')
  const lock = await open(lockPath, 'wx', 0o600).catch((error: unknown) => {
    if (hasCode(error, 'EEXIST')) {
      throw new Error('Another command owns .plain-note/lock. If it was interrupted, remove that lock and retry.')
    }
    throw error
  })
  try {
    await lock.writeFile(String(process.pid))
    await workspace.load()
    return await operation(workspace)
  } finally {
    await lock.close()
    await rm(lockPath)
  }
}

export function pending(local: LocalNote) {
  return local.base?.revision !== local.note.revision
}

export async function atomicWrite(path: string, content: string | Uint8Array, mode = 0o600) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { flag: 'wx', mode })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function readOptional(path: string) {
  if (!(await regularPath(path))) return null
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null
    throw error
  }
}

export async function regularPath(path: string, directory = false) {
  try {
    const entry = await lstat(path)
    if (directory ? !entry.isDirectory() : !entry.isFile()) {
      throw new Error(`Expected a regular ${directory ? 'directory' : 'file'}: ${path}`)
    }
    return entry
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null
    throw error
  }
}

function hasCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

function segment(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid note or resource ID')
  return value
}
