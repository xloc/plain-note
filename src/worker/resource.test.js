import { expect, test, vi } from 'vite-plus/test'
import worker from './index.ts'
import { cleanupResources, putNote } from './storage.ts'

const vaultHeaders = { 'X-Vault-Key-Id': 'a'.repeat(43) }

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
      uploaded: new Date(),
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
      uploaded: object.uploaded,
    }
  }

  async head(key) {
    return this.objects.get(key) ?? null
  }

  async delete(key) {
    if (Array.isArray(key)) {
      for (const item of key) this.objects.delete(item)
    } else {
      this.objects.delete(key)
    }
  }

  async list({ prefix = '' } = {}) {
    return {
      objects: [...this.objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({ key, size: object.blob?.size ?? 0, uploaded: object.uploaded })),
      truncated: false,
    }
  }
}

class DB {
  cleanupFailures = 0
  lastCleanupFailure = 0

  async batch(statements) {
    for (const statement of statements) await statement.run()
  }

  prepare(source) {
    const db = this
    let values = []
    return {
      bind(...args) {
        values = args
        return this
      },
      async run() {
        if (source.includes('INSERT INTO server_issues')) {
          db.cleanupFailures += 1
          db.lastCleanupFailure = values[1]
        }
        if (source.includes('DELETE FROM server_issues')) db.cleanupFailures = 0
      },
      async all() {
        if (source.includes('SELECT key, value FROM index_meta'))
          return {
            results: [
              { key: 'schema_version', value: '3' },
              { key: 'generation', value: 'generation-1' },
            ],
          }
        if (source.includes('SUM(resource_count)')) return { results: [{ count: 0 }] }
        if (source.includes('FROM server_issues') && db.cleanupFailures)
          return {
            results: [
              {
                code: 'resource_cleanup_failed',
                lastOccurredAt: db.lastCleanupFailure,
                occurrences: db.cleanupFailures,
              },
            ],
          }
        return { results: [] }
      },
    }
  }
}

test('uploads and downloads opaque immutable resource ciphertext by UUID', async () => {
  const bucket = new Bucket()
  const env = { NOTES: bucket, TEST_AUTH_BYPASS: true }
  const url = 'http://localhost:8787/api/notes/note-id/resources/resource-id'

  const upload = await worker.fetch(
    new Request(url, {
      method: 'PUT',
      headers: {
        ...vaultHeaders,
        'Content-Type': 'application/octet-stream',
      },
      body: 'resource bytes',
    }),
    env,
  )
  expect(upload.status).toBe(200)
  expect(await upload.json()).toEqual({ ok: true })

  const download = await worker.fetch(new Request(url, { headers: vaultHeaders }), env)
  expect(download.status).toBe(200)
  expect(download.headers.get('Content-Type')).toBe('application/octet-stream')
  expect(await download.text()).toBe('resource bytes')

  const retry = await worker.fetch(
    new Request(url, {
      method: 'PUT',
      headers: {
        ...vaultHeaders,
        'Content-Type': 'application/octet-stream',
      },
      body: 'different retry ciphertext',
    }),
    env,
  )
  expect(retry.status).toBe(200)
  expect(await (await worker.fetch(new Request(url, { headers: vaultHeaders }), env)).text()).toBe('resource bytes')

  await cleanupResources(bucket, 'note-id', [])
  expect((await worker.fetch(new Request(url, { headers: vaultHeaders }), env)).status).toBe(200)

  await cleanupResources(bucket, 'note-id', [], ['resource-id'])
  expect((await worker.fetch(new Request(url, { headers: vaultHeaders }), env)).status).toBe(404)
  expect((await worker.fetch(new Request(url, { method: 'DELETE', headers: vaultHeaders }), env)).status).toBe(405)
})

test('rejects a different vault key before returning ciphertext', async () => {
  const bucket = new Bucket()
  const env = { NOTES: bucket, TEST_AUTH_BYPASS: true }
  const url = 'http://localhost:8787/api/notes/note-id/resources/resource-id'
  await worker.fetch(new Request(url, { method: 'PUT', headers: vaultHeaders, body: 'ciphertext' }), env)

  const response = await worker.fetch(new Request(url, { headers: { 'X-Vault-Key-Id': 'b'.repeat(43) } }), env)

  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({ error: 'vault_key_mismatch' })
})

test('rebuilds the cloud vault with a new key identifier', async () => {
  const bucket = new Bucket()
  const env = { DB: new DB(), NOTES: bucket, TEST_AUTH_BYPASS: true }
  const resourceUrl = 'http://localhost:8787/api/notes/note-id/resources/resource-id'
  await worker.fetch(new Request(resourceUrl, { method: 'PUT', headers: vaultHeaders, body: 'ciphertext' }), env)
  await putNote(
    bucket,
    {
      id: 'note-id',
      updatedAt: 1,
      revision: 'revision-1',
      resourceIds: ['resource-id'],
      encrypted: 'opaque-note-ciphertext',
    },
    null,
  )

  const newKeyId = 'b'.repeat(43)
  const response = await worker.fetch(
    new Request('http://localhost:8787/api/vault/rebuild', {
      method: 'POST',
      headers: { ...vaultHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyId: newKeyId }),
    }),
    env,
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
  expect([...bucket.objects.keys()]).toEqual(['vault/key.json'])
  expect(
    (
      await worker.fetch(
        new Request('http://localhost:8787/api/sync?after=0', {
          headers: vaultHeaders,
        }),
        env,
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await worker.fetch(
        new Request('http://localhost:8787/api/sync?after=0', {
          headers: { 'X-Vault-Key-Id': newKeyId },
        }),
        env,
      )
    ).status,
  ).toBe(200)
})

test('cleans up expired unreferenced uploads', async () => {
  const bucket = new Bucket()
  bucket.objects.set('notes/note-id/resources/expired-id', {
    blob: new Blob(['expired']),
    httpMetadata: { contentType: 'text/plain' },
    uploaded: new Date(0),
  })

  await cleanupResources(bucket, 'note-id', [])

  expect(bucket.objects.has('notes/note-id/resources/expired-id')).toBe(false)
})

test('records a cleanup failure without failing the committed note', async () => {
  const bucket = new Bucket()
  const env = { DB: new DB(), NOTES: bucket, TEST_AUTH_BYPASS: true }
  const note = {
    id: 'note-id',
    updatedAt: 1,
    revision: 'revision-1',
    resourceIds: [],
    encrypted: 'opaque-note-ciphertext',
  }
  const list = bucket.list.bind(bucket)
  bucket.list = async (options) => {
    if (options.prefix === 'notes/note-id/resources/') throw new Error('R2 unavailable')
    return list(options)
  }
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})

  try {
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/notes/note-id', {
        method: 'PUT',
        headers: vaultHeaders,
        body: JSON.stringify({ baseRevision: null, note }),
      }),
      env,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ note })
    expect(log).toHaveBeenCalledWith('Resource cleanup failed', {
      noteId: 'note-id',
      error: expect.any(Error),
    })

    const status = await worker.fetch(new Request('http://localhost:8787/api/storage'), env)
    expect((await status.json()).issues).toEqual([
      {
        code: 'resource_cleanup_failed',
        lastOccurredAt: expect.any(Number),
        occurrences: 1,
      },
    ])
  } finally {
    log.mockRestore()
  }
})

test('scheduled cleanup uses opaque IDs and preserves referenced resources regardless of age', async () => {
  const bucket = new Bucket()
  const db = new DB()
  db.cleanupFailures = 1
  await putNote(
    bucket,
    {
      id: 'note-id',
      updatedAt: 1,
      revision: 'revision-1',
      resourceIds: ['referenced-id'],
      encrypted: 'opaque-note-ciphertext',
    },
    null,
  )
  bucket.objects.set('notes/note-id/resources/referenced-id', {
    blob: new Blob(['kept']),
    uploaded: new Date(0),
  })
  bucket.objects.set('notes/note-id/resources/orphan-id', {
    blob: new Blob(['gone']),
    uploaded: new Date(0),
  })
  bucket.objects.set('notes/note-id/resources/fresh-id', {
    blob: new Blob(['fresh']),
    uploaded: new Date(),
  })

  await worker.scheduled({}, { DB: db, NOTES: bucket }, {})

  expect(bucket.objects.has('notes/note-id/resources/referenced-id')).toBe(true)
  expect(bucket.objects.has('notes/note-id/resources/orphan-id')).toBe(false)
  expect(bucket.objects.has('notes/note-id/resources/fresh-id')).toBe(true)
  expect(db.cleanupFailures).toBe(0)
})

test('records and surfaces a scheduled cleanup failure', async () => {
  const bucket = new Bucket()
  const db = new DB()
  bucket.list = async () => {
    throw new Error('R2 unavailable')
  }
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})

  try {
    await expect(worker.scheduled({}, { DB: db, NOTES: bucket }, {})).rejects.toThrow('R2 unavailable')
    expect(db.cleanupFailures).toBe(1)
    expect(log).toHaveBeenCalledWith('Scheduled resource cleanup failed', expect.any(Error))
  } finally {
    log.mockRestore()
  }
})

test('derives immediate resource removal from a note metadata update', async () => {
  const bucket = new Bucket()
  const env = { DB: new DB(), NOTES: bucket, TEST_AUTH_BYPASS: true }
  const resourceUrl = 'http://localhost:8787/api/notes/note-id/resources/resource-id'
  await worker.fetch(
    new Request(resourceUrl, {
      method: 'PUT',
      headers: {
        ...vaultHeaders,
        'Content-Type': 'application/octet-stream',
      },
      body: 'resource',
    }),
    env,
  )

  const note = {
    id: 'note-id',
    updatedAt: 1,
    revision: 'revision-1',
    resourceIds: ['resource-id'],
    encrypted: 'opaque-note-ciphertext-1',
  }
  const created = await worker.fetch(
    new Request('http://localhost:8787/api/notes/note-id', {
      method: 'PUT',
      headers: vaultHeaders,
      body: JSON.stringify({ baseRevision: null, note }),
    }),
    env,
  )
  expect(created.status).toBe(200)
  expect((await worker.fetch(new Request(resourceUrl, { headers: vaultHeaders }), env)).status).toBe(200)

  const updated = await worker.fetch(
    new Request('http://localhost:8787/api/notes/note-id', {
      method: 'PUT',
      headers: vaultHeaders,
      body: JSON.stringify({
        baseRevision: 'revision-1',
        note: {
          ...note,
          resourceIds: [],
          encrypted: 'opaque-note-ciphertext-2',
          updatedAt: 2,
          revision: 'revision-2',
        },
      }),
    }),
    env,
  )
  expect(updated.status).toBe(200)
  expect((await worker.fetch(new Request(resourceUrl, { headers: vaultHeaders }), env)).status).toBe(404)
})
