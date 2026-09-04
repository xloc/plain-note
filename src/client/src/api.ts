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
  SyncResponse,
  Tombstone,
} from '../../shared/note'
import * as encryption from './encryption'
import { currentVault } from './stores/vault'

export class ApiConflict extends Error {
  constructor(public current: ConflictResponse['current']) {
    super('The note changed on another device')
  }
}

export class ApiSessionRequired extends Error {
  constructor() {
    super('Session required')
  }
}

export class ApiNotFound extends Error {
  constructor() {
    super('Not found')
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
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', `/api/notes/${noteId}/resources/${resource.id}`)
    request.setRequestHeader('Content-Type', 'application/octet-stream')
    request.setRequestHeader('X-Vault-Key-Id', vault.id)
    request.upload.onprogress = (event) => onProgress(event.total ? event.loaded / event.total : 0)
    request.onerror = () => reject(new Error('Resource upload failed'))
    request.onload = () => {
      const body = JSON.parse(request.responseText) as { ok: true } | { error: string }
      if (request.status < 200 || request.status >= 300) {
        reject(apiError(request.status, body))
      } else {
        onProgress(1)
        resolve()
      }
    }
    request.send(encrypted)
  })
}

export async function getResource(noteId: string, resource: NoteResource) {
  const vault = currentVault()
  const response = await fetch(`/api/notes/${noteId}/resources/${resource.id}`, {
    headers: { 'X-Vault-Key-Id': vault.id },
  })
  if (!response.ok) {
    const body = (await response.json()) as { error?: string }
    throw apiError(response.status, body)
  }
  return encryption.resource.decrypt(await response.blob(), noteId, resource.id, resource.mime, vault.key)
}

export async function getChanges(generation: string | null, after: number) {
  const query = new URLSearchParams({ after: String(after) })
  if (generation) {
    query.set('generation', generation)
  }
  return api<SyncResponse>(`/api/sync?${query}`)
}

export async function rebuildVault(keyId: string) {
  return api<{ ok: true }>('/api/vault/rebuild', {
    method: 'POST',
    body: JSON.stringify({ keyId } satisfies RebuildVaultRequest),
  })
}

async function api<T extends object>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('X-Vault-Key-Id', currentVault().id)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  const body = (await response.json()) as T | RemoteConflictResponse | { error: string }
  if (response.status === 409) {
    const current = (body as RemoteConflictResponse).current
    throw new ApiConflict(await encryption.record.decrypt(current, currentVault().key))
  }

  if (!response.ok) {
    throw apiError(response.status, body)
  }

  return body as T
}

function apiError(status: number, body: object) {
  const message = 'error' in body && typeof body.error === 'string' ? body.error : `Request failed with ${status}`
  if (message === 'vault_key_mismatch')
    return new Error('This device has a different encryption key from the cloud vault')
  if (status === 404 && message === 'not_found') return new ApiNotFound()
  return status === 401 && message === 'session_required' ? new ApiSessionRequired() : new Error(message)
}
