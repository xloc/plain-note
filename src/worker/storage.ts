import type { EncryptedNote, RemoteNoteRecord, Tombstone } from '../shared/note'

const RESOURCE_GRACE_MS = 24 * 60 * 60 * 1000

export type StoredRecord = {
  record: RemoteNoteRecord
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
  const kind = object.customMetadata?.kind
  if (kind !== 'tombstone' && kind !== 'encrypted-note') throw new Error('Unsupported note format')
  const record = JSON.parse(source) as RemoteNoteRecord

  return { record, etag: object.etag }
}

export async function putNote(bucket: R2Bucket, note: EncryptedNote, etag: string | null) {
  return bucket.put(noteKey(note.id), JSON.stringify(note), {
    onlyIf: condition(etag),
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { kind: 'encrypted-note', revision: note.revision },
  })
}

export async function putTombstone(bucket: R2Bucket, tombstone: Tombstone, etag: string) {
  return bucket.put(noteKey(tombstone.id), JSON.stringify(tombstone, null, 2), {
    onlyIf: { etagMatches: etag },
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { kind: 'tombstone', revision: tombstone.revision },
  })
}

export async function getResource(bucket: R2Bucket, noteId: string, id: string) {
  return bucket.get(resourceKey(noteId, id))
}

export async function putResource(bucket: R2Bucket, noteId: string, resourceId: string, body: ReadableStream) {
  const key = resourceKey(noteId, resourceId)
  const existing = await bucket.head(key)
  if (existing) return existing

  return bucket.put(key, body, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'application/octet-stream' },
  })
}

export async function deleteResource(bucket: R2Bucket, noteId: string, id: string) {
  await bucket.delete(resourceKey(noteId, id))
}

export async function clearNotes(bucket: R2Bucket) {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: 'notes/', cursor })
    keys.push(...page.objects.map((object) => object.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  for (let start = 0; start < keys.length; start += 1000) await bucket.delete(keys.slice(start, start + 1000))
}

export async function cleanupResources(
  bucket: R2Bucket,
  noteId: string,
  referencedIds: string[],
  removedIds: string[] = [],
) {
  const referenced = new Set(referencedIds)
  const removed = new Set(removedIds)
  const now = Date.now()
  let cursor: string | undefined
  do {
    const page = await bucket.list({
      prefix: `notes/${noteId}/resources/`,
      cursor,
    })
    const expired = page.objects
      .filter((object) => {
        const id = object.key.slice(`notes/${noteId}/resources/`.length)
        const expiresAt = object.uploaded.getTime() + RESOURCE_GRACE_MS
        return !referenced.has(id) && (removed.has(id) || expiresAt <= now)
      })
      .map((object) => object.key)
    if (expired.length) await bucket.delete(expired)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
}

export async function cleanupExpiredResources(bucket: R2Bucket) {
  const now = Date.now()
  const candidates = new Map<string, { id: string; key: string }[]>()
  let cursor: string | undefined
  do {
    const page = await bucket.list({
      prefix: 'notes/',
      cursor,
    })
    for (const object of page.objects) {
      const match = object.key.match(/^notes\/([^/]+)\/resources\/([^/]+)$/)
      const expiresAt = object.uploaded.getTime() + RESOURCE_GRACE_MS
      if (match && expiresAt <= now) {
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
    const referenced = new Set(stored && !('deleted' in stored.record) ? stored.record.resourceIds : [])
    expired.push(...resources.filter((resource) => !referenced.has(resource.id)).map((resource) => resource.key))
  }

  for (let start = 0; start < expired.length; start += 1000) await bucket.delete(expired.slice(start, start + 1000))
}

function condition(etag: string | null): R2Conditional | Headers {
  if (etag) return { etagMatches: etag }

  return new Headers({ 'If-None-Match': '*' })
}
