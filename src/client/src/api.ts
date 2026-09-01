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
        reject(new Error('error' in body ? body.error : `Request failed with ${request.status}`))
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
    throw new Error(body.error ?? `Request failed with ${response.status}`)
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
  const response = await fetch(path, {
    ...init,
    headers: init?.headers ?? (init?.body ? { 'Content-Type': 'application/json' } : undefined),
  })
  const body = (await response.json()) as T | ConflictResponse | { error: string }
  if (response.status === 409) {
    throw new ApiConflict((body as ConflictResponse).current)
  }

  if (!response.ok) {
    const message = 'error' in body ? body.error : `Request failed with ${response.status}`
    throw new Error(message)
  }

  return body as T
}
