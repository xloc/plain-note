import assert from 'node:assert/strict'
import test from 'node:test'
import { blockedLimit, requireFreeTierCapacity } from './usage.ts'

const available = {
  d1RowsRead: 0,
  d1RowsWritten: 0,
  d1StorageBytes: 0,
  r2ClassA: 0,
  r2ClassB: 0,
  r2StorageBytes: 0,
  r2InfrequentBytes: 0,
}

test('allows local development without usage configuration', async () => {
  const request = new Request('http://localhost:8787/api/sync')
  assert.equal(await requireFreeTierCapacity(request, {}), null)
})

test('allows health checks without usage configuration', async () => {
  const request = new Request('https://notes.example.com/api/health')
  assert.equal(await requireFreeTierCapacity(request, {}), null)
})

test('fails closed when deployed without usage configuration', async () => {
  const request = new Request('https://notes.example.com/api/sync')
  const response = await requireFreeTierCapacity(request, {})
  assert.equal(response?.status, 500)
  assert.deepEqual(await response?.json(), { error: 'usage_not_configured' })
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
            accounts: [{
              d1: [{ sum: { rowsRead: 4_000_000, rowsWritten: 0 } }],
              r2: [{ dimensions: { actionType: 'GetObject' }, sum: { requests: 1 } }],
            }],
          },
        },
      })
    }
    if (url.includes('/d1/database?'))
      return Response.json({ success: true, result: [{ uuid: 'database-id' }] })
    if (url.includes('/d1/database/database-id'))
      return Response.json({ success: true, result: { file_size: 1000 } })
    if (url.endsWith('/r2/metrics')) {
      return Response.json({
        success: true,
        result: { standard: { published: { payloadSize: 1000, metadataSize: 100 } } },
      })
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  try {
    const response = await requireFreeTierCapacity(
      new Request('https://notes.example.com/api/sync'),
      { CLOUDFLARE_ACCOUNT_ID: 'account-id', CLOUDFLARE_USAGE_TOKEN: 'token' },
    )
    assert.equal(response?.status, 503)
    assert.deepEqual(await response?.json(), {
      error: 'free_tier_limit_near',
      limit: 'd1_rows_read',
    })
  }
  finally {
    globalThis.fetch = originalFetch
  }
})
