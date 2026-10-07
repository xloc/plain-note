import { CLIENT_SESSION_COOKIE, SESSION_COOKIE } from '@plain-note/shared/auth'
import * as encryption from '@plain-note/shared/encryption'
import type {
  DeleteNoteRequest,
  EncryptedNote,
  Note,
  NoteRecord,
  NoteResource,
  SyncResponse,
  Tombstone,
} from '@plain-note/shared/note'
import type { Config } from './workspace.ts'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly current?: NoteRecord,
  ) {
    super(
      code === 'session_required'
        ? 'Session expired or revoked. Run note auth.'
        : code === 'vault_key_mismatch'
          ? 'The vault key changed. Run note auth with the current recovery key.'
          : code,
    )
  }
}

export type NoteApi = {
  changes(generation: string | null, cursor: number): Promise<SyncResponse>
  get(id: string): Promise<NoteRecord>
  put(note: Note, baseRevision: string | null): Promise<Note>
  delete(id: string, body: DeleteNoteRequest): Promise<Tombstone>
  resource(noteId: string, resource: NoteResource): Promise<Uint8Array>
  restoreResource(noteId: string, resource: NoteResource, bytes: Uint8Array): Promise<void>
}

export async function createApi(config: Config): Promise<NoteApi> {
  const vault = await encryption.recoveryKey.import(config.recoveryKey)
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(new URL(path, config.server), {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Origin: new URL(config.server).origin,
        Cookie: `${SESSION_COOKIE}=${config.token}; ${CLIENT_SESSION_COOKIE}=${config.clientKey}`,
        'X-Vault-Key-Id': vault.id,
        'Content-Type': init?.body instanceof Blob ? 'application/octet-stream' : 'application/json',
      },
    })
    if (!response.ok) {
      const body = (await response.json()) as { error: string; current?: EncryptedNote | Tombstone }
      throw new ApiError(
        response.status,
        body.error,
        body.current ? await encryption.record.decrypt(body.current, vault.key) : undefined,
      )
    }
    return response
  }
  return {
    async changes(generation, cursor) {
      const query = new URLSearchParams({ after: String(cursor) })
      if (generation) query.set('generation', generation)
      return (await request(`/api/sync?${query}`)).json() as Promise<SyncResponse>
    },
    async get(id) {
      try {
        const body = (await (await request(`/api/notes/${encodeURIComponent(id)}`)).json()) as { note: EncryptedNote }
        return encryption.note.decrypt(body.note, vault.key)
      } catch (error) {
        if (error instanceof ApiError && error.status === 410 && error.current) return error.current
        throw error
      }
    },
    async put(note, baseRevision) {
      const encrypted = await encryption.note.encrypt(note, vault.key)
      const body = (await (
        await request(`/api/notes/${encodeURIComponent(note.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ baseRevision, note: encrypted }),
        })
      ).json()) as { note: EncryptedNote }
      return encryption.note.decrypt(body.note, vault.key)
    },
    async delete(id, body) {
      const result = (await (
        await request(`/api/notes/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          body: JSON.stringify(body),
        })
      ).json()) as { tombstone: Tombstone }
      return result.tombstone
    },
    async resource(noteId, resource) {
      const response = await request(
        `/api/notes/${encodeURIComponent(noteId)}/resources/${encodeURIComponent(resource.id)}`,
      )
      const blob = await encryption.resource.decrypt(
        await response.blob(),
        noteId,
        resource.id,
        resource.mime,
        vault.key,
      )
      return new Uint8Array(await blob.arrayBuffer())
    },
    async restoreResource(noteId, resource, bytes) {
      const blob = new Blob([Uint8Array.from(bytes)])
      const encrypted = await encryption.resource.encrypt(blob, noteId, resource.id, vault.key)
      await request(`/api/notes/${encodeURIComponent(noteId)}/resources/${encodeURIComponent(resource.id)}`, {
        method: 'PUT',
        body: encrypted,
      })
    },
  }
}
