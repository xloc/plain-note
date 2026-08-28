import type {
  ConflictResponse,
  DeleteNoteRequest,
  Note,
  PutNoteRequest,
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
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
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
