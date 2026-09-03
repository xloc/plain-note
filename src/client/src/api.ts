import type {
  ConflictResponse,
  DeleteNoteRequest,
  Note,
  NoteResource,
  PutNoteRequest,
  StorageUsage,
  SyncResponse,
  Tombstone,
} from '../../shared/note'

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

export async function putNote(body: PutNoteRequest) {
  return api<{ note: Note }>(`/api/notes/${body.note.id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function deleteNote(id: string, body: DeleteNoteRequest) {
  return api<{ tombstone: Tombstone }>(`/api/notes/${id}`, {
    method: 'DELETE',
    body: JSON.stringify(body),
  })
}

export async function getNote(id: string) {
  return api<{ note: Note }>(`/api/notes/${id}`)
}

export async function getStorageUsage() {
  return api<StorageUsage>('/api/usage')
}

export function putResource(
  noteId: string,
  resource: NoteResource,
  blob: Blob,
  onProgress: (progress: number) => void,
) {
  return new Promise<{ resource: NoteResource }>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', `/api/notes/${noteId}/resources/${resource.id}`)
    request.setRequestHeader('Content-Type', resource.mime || 'application/octet-stream')
    request.setRequestHeader('X-Resource-Name', encodeURIComponent(resource.name))
    request.setRequestHeader('X-Resource-Size', String(resource.size))
    request.setRequestHeader('X-Resource-Created-At', String(resource.createdAt))
    request.upload.onprogress = (event) => onProgress(event.total ? event.loaded / event.total : 0)
    request.onerror = () => reject(new Error('Resource upload failed'))
    request.onload = () => {
      const body = JSON.parse(request.responseText) as { resource: NoteResource } | { error: string }
      if (request.status < 200 || request.status >= 300) {
        reject(apiError(request.status, body))
      } else {
        onProgress(1)
        resolve(body as { resource: NoteResource })
      }
    }
    request.send(blob)
  })
}

export async function getResource(noteId: string, id: string) {
  const response = await fetch(`/api/notes/${noteId}/resources/${id}`)
  if (!response.ok) {
    const body = (await response.json()) as { error?: string }
    throw apiError(response.status, body)
  }
  return response.blob()
}

export async function getChanges(generation: string | null, after: number) {
  const query = new URLSearchParams({ after: String(after) })
  if (generation) {
    query.set('generation', generation)
  }
  return api<SyncResponse>(`/api/sync?${query}`)
}

async function api<T extends object>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, {
    ...init,
    headers,
  })
  const body = (await response.json()) as T | ConflictResponse | { error: string }
  if (response.status === 409) {
    throw new ApiConflict((body as ConflictResponse).current)
  }

  if (!response.ok) {
    throw apiError(response.status, body)
  }

  return body as T
}

function apiError(status: number, body: object) {
  const message = 'error' in body && typeof body.error === 'string' ? body.error : `Request failed with ${status}`
  return status === 401 && message === 'session_required' ? new ApiSessionRequired() : new Error(message)
}
