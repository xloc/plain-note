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

export type EncryptedNote = {
  id: string
  revision: string
  updatedAt: number
  resourceIds: string[]
  encrypted: string
}

export type RemoteNoteRecord = EncryptedNote | Tombstone

export type PutEncryptedNoteRequest = {
  baseRevision: string | null
  note: EncryptedNote
}

export type DeleteNoteRequest = {
  baseRevision: string
  revision: string
  updatedAt: number
}

export type RebuildVaultRequest = {
  keyId: string
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

export type StorageStatus = {
  usedBytes: number
  limitBytes: number
  cutoffBytes: number
  referencedResources: number
  storedResources: number
  issues: ServerIssue[]
}

export type ServerIssue = {
  code: 'resource_cleanup_failed'
  lastOccurredAt: number
  occurrences: number
}

export type ConflictResponse = {
  error: 'conflict'
  current: NoteRecord
}

export type RemoteConflictResponse = {
  error: 'conflict'
  current: RemoteNoteRecord
}
