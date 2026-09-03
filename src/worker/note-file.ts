import { parse, stringify } from 'yaml'
import type { Note, Tombstone } from '../shared/note'

export function serializeNote(note: Note) {
  const { content, ...metadata } = note
  return `---\n${stringify(metadata).trimEnd()}\n---\n\n${content}`
}

export function parseNote(source: string): Note {
  if (!source.startsWith('---\n')) throw new Error('Note is missing YAML front matter')

  const end = source.indexOf('\n---\n', 4)
  if (end === -1) throw new Error('Note has unterminated YAML front matter')

  const metadata = parse(source.slice(4, end)) as Omit<Note, 'content'>
  return {
    ...metadata,
    content: source.slice(end + 5).replace(/^\n/, ''),
  }
}

export function serializeTombstone(tombstone: Tombstone) {
  return JSON.stringify(tombstone, null, 2)
}
