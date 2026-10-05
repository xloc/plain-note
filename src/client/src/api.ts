import type {
  ConflictResponse,
  DeleteNoteRequest,
  Note,
  NoteResource,
  PutEncryptedNoteRequest,
  RebuildVaultRequest,
  RemoteConflictResponse,
  EncryptedNote,
  StorageStatus,
  SyncGateToken,
  SyncResponse,
  SyncWaitResponse,
  Tombstone,
} from '../../shared/note'
import * as encryption from './encryption'
import * as http from './http'
import { useAuthStore } from './stores/auth'
import { currentVault } from './stores/vault'

export class ApiConflict extends Error {
  constructor(public current: ConflictResponse['current']) {
    super('The note changed on another device')
  }
}

export class ApiNotFound extends Error {
  constructor() {
    super('Not found')
  }
}

export class ApiAutoSyncPaused extends Error {
  constructor(public retryAt: number) {
    super('Automatic synchronization paused for the free-tier reset')
  }
}

export async function putNote(body: { baseRevision: string | null; note: Note }) {
  const vault = currentVault()
  const encrypted: PutEncryptedNoteRequest = {
    baseRevision: body.baseRevision,
    note: await encryption.note.encrypt(body.note, vault.key),
  }
  const result = await api<{ note: EncryptedNote }>(`/api/notes/${body.note.id}`, {
    method: 'PUT',
    body: JSON.stringify(encrypted),
  })
  return { note: await encryption.note.decrypt(result.note, vault.key) }
}

export async function deleteNote(id: string, body: DeleteNoteRequest) {
  return api<{ tombstone: Tombstone }>(`/api/notes/${id}`, {
    method: 'DELETE',
    body: JSON.stringify(body),
  })
}

export async function getNote(id: string) {
  const vault = currentVault()
  const result = await api<{ note: EncryptedNote }>(`/api/notes/${id}`)
  return { note: await encryption.note.decrypt(result.note, vault.key) }
}

export async function getStorageStatus() {
  return api<StorageStatus>('/api/storage')
}

export async function putResource(
  noteId: string,
  resource: NoteResource,
  blob: Blob,
  onProgress: (progress: number) => void,
) {
  const vault = currentVault()
  const encrypted = await encryption.resource.encrypt(blob, noteId, resource.id, vault.key)
  return cloudRequest(() =>
    http.upload(
      `/api/notes/${noteId}/resources/${resource.id}`,
      encrypted,
      { 'Content-Type': 'application/octet-stream', 'X-Vault-Key-Id': vault.id },
      onProgress,
    ),
  )
}

export async function getResource(noteId: string, resource: NoteResource) {
  const vault = currentVault()
  const response = await cloudRequest(() =>
    http.fetchResponse(`/api/notes/${noteId}/resources/${resource.id}`, {
      headers: { 'X-Vault-Key-Id': vault.id },
    }),
  )
  return encryption.resource.decrypt(await response.blob(), noteId, resource.id, resource.mime, vault.key)
}

export async function getChanges(generation: string | null, after: number) {
  const query = new URLSearchParams({ after: String(after) })
  if (generation) {
    query.set('generation', generation)
  }
  return api<SyncResponse>(`/api/sync?${query}`)
}

export async function waitForChanges(
  generation: string | null,
  after: number,
  gate: SyncGateToken | null,
  signal: AbortSignal,
) {
  const query = new URLSearchParams({ after: String(after), wait: '1' })
  if (generation) query.set('generation', generation)
  if (gate) {
    query.set('gateGeneration', gate.generation)
    query.set('gateVersion', String(gate.version))
  }
  return api<SyncWaitResponse>(`/api/sync?${query}`, { signal })
}

export async function rebuildVault(keyId = currentVault().id) {
  return api<{ ok: true }>('/api/vault/rebuild', {
    method: 'POST',
    body: JSON.stringify({ keyId } satisfies RebuildVaultRequest),
  })
}

async function api<T extends object>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('X-Vault-Key-Id', currentVault().id)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return cloudRequest(() => http.request<T>(path, { ...init, headers }))
}

async function cloudRequest<T>(operation: () => Promise<T>) {
  try {
    return await useAuthStore().withSession(operation)
  } catch (error) {
    if (!(error instanceof http.HttpError)) throw error
    const body = error.body
    if (error.status === 409 && body?.error === 'conflict') {
      const current = (body as RemoteConflictResponse).current
      throw new ApiConflict(await encryption.record.decrypt(current, currentVault().key))
    }
    if (body?.error === 'auto_sync_paused' && typeof body.retryAt === 'number') {
      throw new ApiAutoSyncPaused(body.retryAt)
    }
    if (body?.error === 'vault_key_mismatch') {
      throw new Error('This device has a different encryption key from the cloud vault')
    }
    if (error.status === 404 && body?.error === 'not_found') throw new ApiNotFound()
    throw error
  }
}
