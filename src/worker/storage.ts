import type { EncryptedNote, RemoteNoteRecord, Tombstone } from '../shared/note'

const RESOURCE_GRACE_MS = 24 * 60 * 60 * 1000
const EXPIRED_RESOURCE_KIND = 'expired-resource'

export type StoredRecord = {
  record: RemoteNoteRecord
  etag: string
  uploaded: Date
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

  return { record, etag: object.etag, uploaded: object.uploaded }
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
  const object = await bucket.get(resourceKey(noteId, id))
  return object?.customMetadata?.kind === EXPIRED_RESOURCE_KIND ? null : object
}

export async function putResource(bucket: R2Bucket, noteId: string, resourceId: string, body: ReadableStream) {
  // A retry refreshes the cleanup grace period and repairs a resource removed by a racing cleanup.
  return bucket.put(resourceKey(noteId, resourceId), body, {
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

export async function cleanupResources(bucket: R2Bucket, noteId: string) {
  const now = Date.now()
  const stored = await getRecord(bucket, noteId)
  // A stable grace period prevents an older write from deleting resources restored by a newer revision.
  if (stored && stored.uploaded.getTime() + RESOURCE_GRACE_MS > now) return
  const referenced = new Set(stored && !('deleted' in stored.record) ? stored.record.resourceIds : [])
  const expired: { etag: string; key: string }[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({
      prefix: `notes/${noteId}/resources/`,
      cursor,
    })
    expired.push(
      ...page.objects
        .filter((object) => {
          const id = object.key.slice(`notes/${noteId}/resources/`.length)
          const expiresAt = object.uploaded.getTime() + RESOURCE_GRACE_MS
          return object.size > 0 && !referenced.has(id) && expiresAt <= now
        })
        .map((object) => ({ etag: object.etag, key: object.key })),
    )
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  if (!expired.length) return

  const current = await getRecord(bucket, noteId)
  if (current?.etag !== stored?.etag) return
  for (const resource of expired) {
    // Conditional replacement cannot erase a resource that was re-uploaded after the cleanup scan.
    await bucket.put(resource.key, '', {
      onlyIf: { etagMatches: resource.etag },
      customMetadata: { kind: EXPIRED_RESOURCE_KIND },
    })
  }
}

export async function cleanupExpiredResources(bucket: R2Bucket) {
  const now = Date.now()
  const noteIds = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await bucket.list({
      prefix: 'notes/',
      cursor,
    })
    for (const object of page.objects) {
      const match = object.key.match(/^notes\/([^/]+)\/resources\/([^/]+)$/)
      const expiresAt = object.uploaded.getTime() + RESOURCE_GRACE_MS
      if (match && expiresAt <= now) noteIds.add(match[1])
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  for (const noteId of noteIds) await cleanupResources(bucket, noteId)
}

function condition(etag: string | null): R2Conditional | Headers {
  if (etag) return { etagMatches: etag }

  return new Headers({ 'If-None-Match': '*' })
}
