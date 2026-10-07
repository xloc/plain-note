import { randomUUID } from 'node:crypto'
import type { Note } from '@plain-note/shared/note'
import type { Workspace } from './workspace.ts'

export async function newNote(workspace: Workspace) {
  const now = Date.now()
  const note: Note = {
    id: randomUUID(),
    content: '',
    tags: [],
    resources: [],
    createdAt: now,
    updatedAt: now,
    revision: randomUUID(),
  }
  await workspace.writeNote(note)
  workspace.state.notes[note.id] = { note, deleted: false, base: null, resourceHashes: {} }
  await workspace.save()
  return workspace.notePath(note.id)
}
