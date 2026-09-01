export type NoteResource = {
  id: string
  name: string
  mime: string
  size: number
  createdAt: number
}

export type Note = {
  id: string
  content: string
  tags: string[]
  resources: NoteResource[]
  createdAt: number
  updatedAt: number
  revision: string
}

export type Tombstone = {
  id: string
  deleted: true
  updatedAt: number
  revision: string
}

export type NoteRecord = Note | Tombstone

export type PutNoteRequest = {
  baseRevision: string | null
  note: Note
}

export type DeleteNoteRequest = {
  baseRevision: string
  revision: string
  updatedAt: number
}

export type Change = {
  seq: number
  id: string
  revision: string
  updatedAt: number
  operation: 'put' | 'delete'
}

export type SyncResponse = {
  generation: string
  reset: boolean
  cursor: number
  changes: Change[]
}

export type StorageUsage = {
  usedBytes: number
  limitBytes: number
  cutoffBytes: number
}

export type ConflictResponse = {
  error: 'conflict'
  current: NoteRecord
}
