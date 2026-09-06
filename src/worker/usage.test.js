import assert from 'node:assert/strict'
import test from 'node:test'
import { canUseSyncGate, blockedLimit, requireFreeTierCapacity, storageStatusResponse } from './usage.ts'

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

function statusDatabase(referencedResources = 0, issues = []) {
  return {
    prepare(source) {
      return {
        bind() {
          return this
        },
        async run() {},
        async all() {
          if (source.includes("key IN ('schema_version', 'generation')"))
            return {
              results: [
                { key: 'schema_version', value: '3' },
                { key: 'generation', value: 'generation-1' },
              ],
            }
          if (source.includes('SUM(resource_count)')) return { results: [{ count: referencedResources }] }
          if (source.includes('FROM server_issues')) return { results: issues }
          return { results: [] }
        },
      }
    },
  }
}

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

test('reports sanitized storage status', async () => {
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
    const response = await storageStatusResponse(new Request('https://notes.example.com/api/storage'), {
      CLOUDFLARE_ACCOUNT_ID: 'usage-account-id',
      CLOUDFLARE_USAGE_TOKEN: 'token',
      DB: statusDatabase(2),
      NOTES: emptyBucket,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      usedBytes: 1_234,
      limitBytes: 10_000_000_000,
      cutoffBytes: 8_000_000_000,
      referencedResources: 2,
      storedResources: 0,
      issues: [],
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('sums paginated local R2 storage against the development limit', async () => {
  const bucket = {
    async list(options = {}) {
      return options.cursor
        ? { objects: [{ key: 'notes/1/resources/b', size: 300 }], truncated: false }
        : {
            objects: [
              { key: 'notes/1/resources/a', size: 100 },
              { key: 'notes/1/note.md', size: 200 },
            ],
            truncated: true,
            cursor: 'next',
          }
    },
  }
  const issues = [{ code: 'resource_cleanup_failed', lastOccurredAt: 1, occurrences: 2 }]
  const response = await storageStatusResponse(new Request('http://localhost:8787/api/storage'), {
    DB: statusDatabase(1, issues),
    NOTES: bucket,
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    usedBytes: 600,
    limitBytes: 100_000_000,
    cutoffBytes: 80_000_000,
    referencedResources: 1,
    storedResources: 2,
    issues,
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

for (const [name, gateUsage, limit] of [
  ['requests', { requests: 80_000, activeTime: 0 }, 'durable_object_requests'],
  ['duration', { requests: 0, activeTime: 81_250_000_000 }, 'durable_object_duration'],
]) {
  test(`pauses only automatic sync near the Durable Object ${name} limit`, async (t) => {
    let gateQueries = 0
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      const url = String(input)
      if (url.endsWith('/graphql')) {
        const query = JSON.parse(init.body).query
        if (query.includes('SyncGateUsage')) {
          gateQueries++
          return Response.json({
            data: {
              viewer: {
                accounts: [
                  {
                    requests: [{ sum: { requests: gateUsage.requests } }],
                    duration: [{ sum: { activeTime: gateUsage.activeTime } }],
                  },
                ],
              },
            },
          })
        }
        return Response.json({ data: { viewer: { accounts: [{ d1: [], r2: [] }] } } })
      }
      if (url.includes('/d1/database?')) return Response.json({ success: true, result: [] })
      if (url.endsWith('/r2/metrics')) return Response.json({ success: true, result: {} })
      throw new Error(`Unexpected request: ${url}`)
    })

    const env = {
      CLOUDFLARE_ACCOUNT_ID: `sync-gate-${name}`,
      CLOUDFLARE_USAGE_TOKEN: 'token',
      NOTES: emptyBucket,
    }
    const response = await requireFreeTierCapacity(
      new Request('https://notes.example.com/api/sync?after=0&wait=1'),
      env,
    )
    const body = await response.json()

    assert.equal(response.status, 429)
    assert.equal(body.error, 'auto_sync_paused')
    assert.equal(body.limit, limit)
    assert.ok(body.retryAt > Date.now())
    assert.equal(await canUseSyncGate(new Request('https://notes.example.com/api/notes/1'), env), false)
    assert.equal(await requireFreeTierCapacity(new Request('https://notes.example.com/api/sync?after=0'), env), null)
    assert.equal(gateQueries, 1)
  })
}

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

for (const [action, requests, limit] of [
  ['GetObject', 1, null],
  ['GetObject', 8_000_000, 'r2_class_b'],
  ['PutObject', 800_000, 'r2_class_a'],
]) {
  test(`unknown operations preserve sync and deletion quota checks with ${requests} ${action} calls`, async (t) => {
    const log = t.mock.method(console, 'error', () => {})
    const warning = t.mock.method(console, 'warn', () => {})
    t.mock.method(globalThis, 'fetch', async (input) => {
      const url = String(input)
      if (url.endsWith('/graphql')) {
        return Response.json({
          data: {
            viewer: {
              accounts: [
                {
                  d1: [],
                  r2: [
                    { dimensions: { actionType: 'GetBucketSippyConfiguration' }, sum: { requests: 8_000_000 } },
                    { dimensions: { actionType: 'GetBucketNotificationConfiguration' }, sum: { requests: 8_000_000 } },
                    { dimensions: { actionType: 'NewR2Operation' }, sum: { requests: 8_000_000 } },
                    { dimensions: { actionType: action }, sum: { requests } },
                  ],
                },
              ],
            },
          },
        })
      }
      if (url.includes('/d1/database?')) return Response.json({ success: true, result: [] })
      if (url.endsWith('/r2/metrics')) return Response.json({ success: true, result: {} })
      throw new Error(`Unexpected request: ${url}`)
    })

    const env = {
      CLOUDFLARE_ACCOUNT_ID: `sippy-${action}-${requests}`,
      CLOUDFLARE_USAGE_TOKEN: 'token',
      NOTES: emptyBucket,
      DB: statusDatabase(),
    }
    for (const request of [
      new Request('https://notes.example.com/api/sync'),
      new Request('https://notes.example.com/api/notes/1', { method: 'PUT' }),
      new Request('https://notes.example.com/api/notes/1', { method: 'DELETE' }),
    ]) {
      const response = await requireFreeTierCapacity(request, env)
      if (limit) {
        assert.equal(response?.status, 503)
        assert.deepEqual(await response.json(), { error: 'free_tier_limit_near', limit })
      } else {
        assert.equal(response, null)
      }
    }
    const status = await storageStatusResponse(new Request('https://notes.example.com/api/storage'), env)
    assert.equal(status.status, 200)
    // Cached usage must not repeat warnings on each sync or storage request.
    assert.deepEqual(
      warning.mock.calls.map((call) => call.arguments),
      [['Ignoring unknown R2 operation in usage totals', 'NewR2Operation']],
    )
    assert.equal(log.mock.callCount(), 0)
  })
}

for (const scenario of [
  { name: 'GraphQL error', endpoint: '/graphql', status: 200, message: 'Query range is too large' },
  { name: 'REST error', endpoint: '/r2/metrics', status: 403, message: 'Permission denied', code: 10000 },
  { name: 'non-JSON response', endpoint: '/r2/metrics', status: 502 },
  { name: 'network failure', endpoint: '/r2/metrics', message: 'Connection failed' },
]) {
  for (const path of ['sync', 'storage']) {
    test(`logs ${scenario.name} server-side for ${path} without exposing credentials`, async (t) => {
      const token = 'private-usage-token'
      const log = t.mock.method(console, 'error', () => {})
      t.mock.method(globalThis, 'fetch', async (input) => {
        const url = String(input)
        if (scenario.endpoint && url.endsWith(scenario.endpoint)) {
          if (!scenario.status) throw new Error(`${scenario.message}: ${token}`)
          if (!scenario.message) return new Response('<html>Bad gateway</html>', { status: scenario.status })
          return Response.json(
            {
              success: scenario.endpoint === '/graphql' ? undefined : false,
              errors: [{ code: scenario.code, message: `${scenario.message}: ${token}`, extensions: { token } }],
            },
            { status: scenario.status },
          )
        }
        if (url.endsWith('/graphql')) {
          return Response.json({
            data: {
              viewer: {
                accounts: [
                  {
                    d1: [],
                    r2: [],
                  },
                ],
              },
            },
          })
        }
        if (url.includes('/d1/database?')) return Response.json({ success: true, result: [] })
        if (url.endsWith('/r2/metrics')) return Response.json({ success: true, result: {} })
        throw new Error(`Unexpected request: ${url}`)
      })

      const request = new Request(`https://notes.example.com/api/${path}`)
      const env = {
        CLOUDFLARE_ACCOUNT_ID: `diagnostic-${scenario.name}-${path}`,
        CLOUDFLARE_USAGE_TOKEN: token,
        NOTES: emptyBucket,
        DB: statusDatabase(),
      }
      const response = await (path === 'sync'
        ? requireFreeTierCapacity(request, env)
        : storageStatusResponse(request, env))

      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: path === 'sync' ? 'usage_unavailable' : 'storage_unavailable' })
      assert.equal(log.mock.callCount(), 1)
      const diagnostic = JSON.stringify(log.mock.calls[0].arguments)
      assert.ok(diagnostic.includes(scenario.endpoint))
      if (scenario.status) assert.ok(diagnostic.includes(`HTTP ${scenario.status}`))
      if (scenario.message) assert.ok(diagnostic.includes(scenario.message))
      if (scenario.code) assert.ok(diagnostic.includes(String(scenario.code)))
      assert.ok(!diagnostic.includes(token))
      assert.ok(!diagnostic.includes('extensions'))
    })
  }
}
