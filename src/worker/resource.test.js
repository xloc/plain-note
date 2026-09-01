import { expect, test } from 'vite-plus/test'
import worker from './index.ts'
import { cleanupResources, putNote } from './storage.ts'

class Bucket {
  objects = new Map()
  etag = 0

  async put(key, body, options) {
    if (options?.onlyIf?.get?.('If-None-Match') === '*' && this.objects.has(key)) return null
    if (options?.onlyIf?.etagMatches && this.objects.get(key)?.etag !== options.onlyIf.etagMatches) return null
    const blob = await new Response(body).blob()
    const object = {
      blob,
      customMetadata: options?.customMetadata,
      etag: `etag-${++this.etag}`,
      httpMetadata: options?.httpMetadata,
    }
    this.objects.set(key, object)
    return { ...object, size: blob.size }
  }

  async get(key) {
    const object = this.objects.get(key)
    if (!object) return null
    return {
      body: object.blob.stream(),
      customMetadata: object.customMetadata,
      etag: object.etag,
      httpMetadata: object.httpMetadata,
      size: object.blob.size,
      text: () => object.blob.text(),
    }
  }

  async delete(key) {
    if (Array.isArray(key)) {
      for (const item of key) this.objects.delete(item)
    } else {
      this.objects.delete(key)
    }
  }

  async list({ prefix }) {
    return {
      objects: [...this.objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({ key, customMetadata: object.customMetadata })),
      truncated: false,
    }
  }
}

class DB {
  prepare(source) {
    return {
      bind() {
        return this
      },
      async run() {},
      async all() {
        return source.includes('SELECT key, value FROM index_meta')
          ? {
              results: [
                { key: 'schema_version', value: '2' },
                { key: 'generation', value: 'generation-1' },
              ],
            }
          : { results: [] }
      },
    }
  }
}

test('uploads and downloads an immutable resource by UUID', async () => {
  const bucket = new Bucket()
  const env = { NOTES: bucket }
  const url = 'http://localhost:8787/api/notes/note-id/resources/resource-id'

  const upload = await worker.fetch(
    new Request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
        'X-Resource-Name': encodeURIComponent('notes é.txt'),
        'X-Resource-Size': '14',
        'X-Resource-Created-At': '100',
      },
      body: 'resource bytes',
    }),
    env,
  )
  expect(upload.status).toBe(200)
  expect(await upload.json()).toEqual({
    resource: {
      id: 'resource-id',
      name: 'notes é.txt',
      mime: 'text/plain',
      size: 14,
      createdAt: 100,
    },
  })

  const download = await worker.fetch(new Request(url), env)
  expect(download.status).toBe(200)
  expect(download.headers.get('Content-Type')).toBe('text/plain')
  expect(await download.text()).toBe('resource bytes')

  const retry = await worker.fetch(
    new Request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
        'X-Resource-Name': encodeURIComponent('notes é.txt'),
        'X-Resource-Size': '14',
        'X-Resource-Created-At': '100',
      },
      body: 'resource bytes',
    }),
    env,
  )
  expect(retry.status).toBe(200)

  const conflictingUpload = await worker.fetch(
    new Request(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
        'X-Resource-Name': encodeURIComponent('different.txt'),
        'X-Resource-Size': '9',
        'X-Resource-Created-At': '100',
      },
      body: 'different',
    }),
    env,
  )
  expect(conflictingUpload.status).toBe(409)
  expect(await conflictingUpload.json()).toEqual({ error: 'resource_conflict' })
  expect(await (await worker.fetch(new Request(url), env)).text()).toBe('resource bytes')

  await cleanupResources(bucket, 'note-id', [])
  expect((await worker.fetch(new Request(url), env)).status).toBe(200)

  await cleanupResources(bucket, 'note-id', [], ['resource-id'])
  expect((await worker.fetch(new Request(url), env)).status).toBe(404)
  expect((await worker.fetch(new Request(url, { method: 'DELETE' }), env)).status).toBe(405)
})

test('cleans up expired unreferenced uploads', async () => {
  const bucket = new Bucket()
  bucket.objects.set('notes/note-id/resources/expired-id', {
    blob: new Blob(['expired']),
    customMetadata: { kind: 'resource', uploadedAt: '0' },
    httpMetadata: { contentType: 'text/plain' },
  })

  await cleanupResources(bucket, 'note-id', [])

  expect(bucket.objects.has('notes/note-id/resources/expired-id')).toBe(false)
})

test('scheduled cleanup removes expired orphans and preserves referenced and fresh resources', async () => {
  const bucket = new Bucket()
  const resource = { id: 'referenced-id', name: 'kept.txt', mime: 'text/plain', size: 4, createdAt: 1 }
  await putNote(bucket, {
    id: 'note-id',
    content: '',
    tags: [],
    resources: [resource],
    createdAt: 1,
    updatedAt: 1,
    revision: 'revision-1',
  }, null)
  bucket.objects.set('notes/note-id/resources/referenced-id', {
    blob: new Blob(['kept']),
    customMetadata: { kind: 'resource', uploadedAt: '0' },
  })
  bucket.objects.set('notes/note-id/resources/orphan-id', {
    blob: new Blob(['gone']),
    customMetadata: { kind: 'resource', uploadedAt: '0' },
  })
  bucket.objects.set('notes/note-id/resources/fresh-id', {
    blob: new Blob(['fresh']),
    customMetadata: { kind: 'resource', uploadedAt: String(Date.now()) },
  })

  await worker.scheduled({}, { NOTES: bucket }, {})

  expect(bucket.objects.has('notes/note-id/resources/referenced-id')).toBe(true)
  expect(bucket.objects.has('notes/note-id/resources/orphan-id')).toBe(false)
  expect(bucket.objects.has('notes/note-id/resources/fresh-id')).toBe(true)
})

test('derives immediate resource removal from a note metadata update', async () => {
  const bucket = new Bucket()
  const env = { DB: new DB(), NOTES: bucket }
  const resourceUrl = 'http://localhost:8787/api/notes/note-id/resources/resource-id'
  await worker.fetch(
    new Request(resourceUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
        'X-Resource-Name': 'resource.txt',
        'X-Resource-Size': '8',
        'X-Resource-Created-At': '100',
      },
      body: 'resource',
    }),
    env,
  )

  const resource = { id: 'resource-id', name: 'resource.txt', mime: 'text/plain', size: 8, createdAt: 100 }
  const note = {
    id: 'note-id',
    content: '',
    tags: [],
    resources: [resource],
    createdAt: 1,
    updatedAt: 1,
    revision: 'revision-1',
  }
  const created = await worker.fetch(
    new Request('http://localhost:8787/api/notes/note-id', {
      method: 'PUT',
      body: JSON.stringify({ baseRevision: null, note }),
    }),
    env,
  )
  expect(created.status).toBe(200)
  expect((await worker.fetch(new Request(resourceUrl), env)).status).toBe(200)

  const updated = await worker.fetch(
    new Request('http://localhost:8787/api/notes/note-id', {
      method: 'PUT',
      body: JSON.stringify({
        baseRevision: 'revision-1',
        note: { ...note, resources: [], updatedAt: 2, revision: 'revision-2' },
      }),
    }),
    env,
  )
  expect(updated.status).toBe(200)
  expect((await worker.fetch(new Request(resourceUrl), env)).status).toBe(404)
})
