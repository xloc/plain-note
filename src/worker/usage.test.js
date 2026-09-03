import assert from 'node:assert/strict'
import test from 'node:test'
import { blockedLimit, requireFreeTierCapacity, storageUsageResponse } from './usage.ts'

const available = {
  d1RowsRead: 0,
  d1RowsWritten: 0,
  d1StorageBytes: 0,
  r2ClassA: 0,
  r2ClassB: 0,
  r2StorageBytes: 0,
  r2InfrequentBytes: 0,
}
const emptyBucket = { list: async () => ({ objects: [], truncated: false }) }

test('allows local development without usage configuration', async () => {
  const request = new Request('http://192.168.1.20:8787/api/sync')
  assert.equal(await requireFreeTierCapacity(request, { NOTES: emptyBucket }), null)
})

test('allows health checks without usage configuration', async () => {
  const request = new Request('https://notes.example.com/api/health')
  assert.equal(await requireFreeTierCapacity(request, { NOTES: emptyBucket }), null)
})

test('fails closed when deployed without usage configuration', async () => {
  const request = new Request('https://notes.example.com/api/sync')
  const response = await requireFreeTierCapacity(request, { NOTES: emptyBucket })
  assert.equal(response?.status, 500)
  assert.deepEqual(await response?.json(), { error: 'usage_not_configured' })
})

test('reports sanitized R2 storage usage', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/graphql')) {
      return Response.json({
        data: { viewer: { accounts: [{ d1: [], r2: [] }] } },
      })
    }
    if (url.includes('/d1/database?')) return Response.json({ success: true, result: [] })
    if (url.endsWith('/r2/metrics')) {
      return Response.json({
        success: true,
        result: { standard: { published: { payloadSize: 1_200, metadataSize: 34 } } },
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const response = await storageUsageResponse(new Request('https://notes.example.com/api/usage'), {
      CLOUDFLARE_ACCOUNT_ID: 'usage-account-id',
      CLOUDFLARE_USAGE_TOKEN: 'token',
      NOTES: emptyBucket,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      usedBytes: 1_234,
      limitBytes: 10_000_000_000,
      cutoffBytes: 8_000_000_000,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sums paginated local R2 storage against the development limit', async () => {
  const bucket = {
    async list(options = {}) {
      return options.cursor
        ? { objects: [{ size: 300 }], truncated: false }
        : { objects: [{ size: 100 }, { size: 200 }], truncated: true, cursor: 'next' }
    },
  }
  const response = await storageUsageResponse(new Request('http://localhost:8787/api/usage'), { NOTES: bucket })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    usedBytes: 600,
    limitBytes: 100_000_000,
    cutoffBytes: 80_000_000,
  })
})

test('blocks local mutations at the development storage cutoff', async () => {
  const bucket = { list: async () => ({ objects: [{ size: 80_000_000 }], truncated: false }) }
  const response = await requireFreeTierCapacity(new Request('http://localhost:8787/api/notes/1', { method: 'PUT' }), {
    NOTES: bucket,
  })

  assert.equal(response?.status, 503)
  assert.deepEqual(await response?.json(), { error: 'free_tier_limit_near', limit: 'r2_storage' })
})

test('blocks sync near the D1 daily read limit', () => {
  const request = new Request('https://notes.example.com/api/sync')
  assert.equal(blockedLimit(request, { ...available, d1RowsRead: 4_000_000 }), 'd1_rows_read')
})

test('blocks note reads near the R2 Class B limit', () => {
  const request = new Request('https://notes.example.com/api/notes/1')
  assert.equal(blockedLimit(request, { ...available, r2ClassB: 8_000_000 }), 'r2_class_b')
})

test('blocks mutations near storage limits', () => {
  const request = new Request('https://notes.example.com/api/notes/1', { method: 'PUT' })
  assert.equal(blockedLimit(request, { ...available, r2StorageBytes: 8_000_000_000 }), 'r2_storage')
})

test('allows operations below the cutoff', () => {
  const request = new Request('https://notes.example.com/api/notes/1', { method: 'PUT' })
  assert.equal(blockedLimit(request, available), null)
})

test('uses account-wide Cloudflare usage', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/graphql')) {
      return Response.json({
        data: {
          viewer: {
            accounts: [
              {
                d1: [{ sum: { rowsRead: 4_000_000, rowsWritten: 0 } }],
                r2: [{ dimensions: { actionType: 'GetObject' }, sum: { requests: 1 } }],
              },
            ],
          },
        },
      })
    }
    if (url.includes('/d1/database?')) return Response.json({ success: true, result: [{ uuid: 'database-id' }] })
    if (url.includes('/d1/database/database-id')) return Response.json({ success: true, result: { file_size: 1000 } })
    if (url.endsWith('/r2/metrics')) {
      return Response.json({
        success: true,
        result: { standard: { published: { payloadSize: 1000, metadataSize: 100 } } },
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const response = await requireFreeTierCapacity(new Request('https://notes.example.com/api/sync'), {
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_USAGE_TOKEN: 'token',
      NOTES: emptyBucket,
    })
    assert.equal(response?.status, 503)
    assert.deepEqual(await response?.json(), {
      error: 'free_tier_limit_near',
      limit: 'd1_rows_read',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
