import type { Note, NoteRecord, Tombstone } from '../shared/note'
import { parseNote, serializeNote, serializeTombstone } from './note-file'

export type StoredRecord = {
  record: NoteRecord
  etag: string
}

export function noteKey(id: string) {
  return `notes/${id}/note.md`
}

export async function getRecord(bucket: R2Bucket, id: string): Promise<StoredRecord | null> {
  const object = await bucket.get(noteKey(id))
  if (!object)
    return null

  const source = await object.text()
  const record = object.customMetadata?.kind === 'tombstone'
    ? JSON.parse(source) as Tombstone
    : parseNote(source)

  return { record, etag: object.etag }
}

export async function putNote(bucket: R2Bucket, note: Note, etag: string | null) {
  return bucket.put(noteKey(note.id), serializeNote(note), {
    onlyIf: condition(etag),
    httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
    customMetadata: { kind: 'note', revision: note.revision },
  })
}

export async function putTombstone(bucket: R2Bucket, tombstone: Tombstone, etag: string) {
  return bucket.put(noteKey(tombstone.id), serializeTombstone(tombstone), {
    onlyIf: { etagMatches: etag },
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { kind: 'tombstone', revision: tombstone.revision },
  })
}

function condition(etag: string | null): R2Conditional | Headers {
  if (etag)
    return { etagMatches: etag }

  return new Headers({ 'If-None-Match': '*' })
}
