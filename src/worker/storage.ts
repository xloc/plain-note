import type { Note, NoteRecord, Tombstone } from '../shared/note'
import { parseNote, serializeNote, serializeTombstone } from './note-file'

const RESOURCE_GRACE_MS = 24 * 60 * 60 * 1000

export type StoredRecord = {
  record: NoteRecord
  etag: string
}

export function noteKey(id: string) {
  return `notes/${id}/note.md`
}

export function resourceKey(noteId: string, id: string) {
  return `notes/${noteId}/resources/${id}`
}

export async function getRecord(bucket: R2Bucket, id: string): Promise<StoredRecord | null> {
  const object = await bucket.get(noteKey(id))
  if (!object) return null

  const source = await object.text()
  const record = object.customMetadata?.kind === 'tombstone' ? (JSON.parse(source) as Tombstone) : parseNote(source)

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

export async function getResource(bucket: R2Bucket, noteId: string, id: string) {
  return bucket.get(resourceKey(noteId, id))
}

export async function putResource(
  bucket: R2Bucket,
  noteId: string,
  resource: { id: string; name: string; mime: string; size: number; createdAt: number },
  body: ReadableStream,
) {
  return bucket.put(resourceKey(noteId, resource.id), body, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: resource.mime || 'application/octet-stream' },
    customMetadata: {
      kind: 'resource',
      name: encodeURIComponent(resource.name),
      size: String(resource.size),
      createdAt: String(resource.createdAt),
      uploadedAt: String(Date.now()),
    },
  })
}

export async function deleteResource(bucket: R2Bucket, noteId: string, id: string) {
  await bucket.delete(resourceKey(noteId, id))
}

export async function cleanupResources(
  bucket: R2Bucket,
  noteId: string,
  referencedIds: string[],
  removedIds: string[] = [],
) {
  const referenced = new Set(referencedIds)
  const removed = new Set(removedIds)
  const expiredBefore = Date.now() - RESOURCE_GRACE_MS
  let cursor: string | undefined
  do {
    const page = await bucket.list({
      prefix: `notes/${noteId}/resources/`,
      cursor,
      include: ['customMetadata'],
    })
    const expired = page.objects
      .filter((object) => {
        const id = object.key.slice(`notes/${noteId}/resources/`.length)
        return (
          !referenced.has(id) && (removed.has(id) || Number(object.customMetadata?.uploadedAt ?? 0) <= expiredBefore)
        )
      })
      .map((object) => object.key)
    if (expired.length) await bucket.delete(expired)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

export async function cleanupExpiredResources(bucket: R2Bucket) {
  const expiredBefore = Date.now() - RESOURCE_GRACE_MS
  const candidates = new Map<string, { id: string; key: string }[]>()
  let cursor: string | undefined
  do {
    const page = await bucket.list({
      prefix: 'notes/',
      cursor,
      include: ['customMetadata'],
    })
    for (const object of page.objects) {
      const match = object.key.match(/^notes\/([^/]+)\/resources\/([^/]+)$/)
      if (match && Number(object.customMetadata?.uploadedAt ?? 0) <= expiredBefore) {
        const resources = candidates.get(match[1]) ?? []
        resources.push({ key: object.key, id: match[2] })
        candidates.set(match[1], resources)
      }
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  const expired: string[] = []
  for (const [noteId, resources] of candidates) {
    const stored = await getRecord(bucket, noteId)
    const referenced = new Set(
      stored && !('deleted' in stored.record)
        ? stored.record.resources.map((resource) => resource.id)
        : [],
    )
    expired.push(...resources.filter((resource) => !referenced.has(resource.id)).map((resource) => resource.key))
  }

  for (let start = 0; start < expired.length; start += 1000)
    await bucket.delete(expired.slice(start, start + 1000))
}

function condition(etag: string | null): R2Conditional | Headers {
  if (etag) return { etagMatches: etag }

  return new Headers({ 'If-None-Match': '*' })
}
