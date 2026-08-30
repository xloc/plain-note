import type { Note, NoteRecord } from '../../../shared/note'
import type { LocalNote } from '../db'

export function toNote(note: LocalNote): Note {
  return {
    id: note.id,
    content: note.content,
    tags: [...note.tags],
    resources: note.resources.map((resource) => ({ ...resource })),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    revision: note.revision,
  }
}

export function fromRemote(note: Note): LocalNote {
  return {
    ...copyNote(note),
    base: copyNote(note),
    deleted: false,
    syncState: 'synced',
  }
}

export function copyNote(note: Note): Note {
  return {
    ...note,
    tags: [...note.tags],
    resources: note.resources.map((resource) => ({ ...resource })),
  }
}

export function copyRecord(record: NoteRecord): NoteRecord {
  return 'deleted' in record ? { ...record } : copyNote(record)
}
