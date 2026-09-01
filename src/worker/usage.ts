import type { StorageUsage } from '../shared/note'
import { isLocalRequest } from './environment.ts'

export type UsageEnv = {
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_USAGE_TOKEN?: string
}

type Usage = {
  d1RowsRead: number
  d1RowsWritten: number
  d1StorageBytes: number
  r2ClassA: number
  r2ClassB: number
  r2StorageBytes: number
  r2InfrequentBytes: number
}

const CUTOFF = 0.8
const CACHE_MS = 60_000
const DEFAULT_DEV_R2_STORAGE_LIMIT_BYTES = 100_000_000
const limits = {
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
  d1StorageBytes: 5_000_000_000,
  r2ClassA: 1_000_000,
  r2ClassB: 10_000_000,
  r2StorageBytes: 10_000_000_000,
}
const r2ClassA = new Set([
  'CompleteMultipartUpload',
  'CopyObject',
  'CreateMultipartUpload',
  'LifecycleStorageTierTransition',
  'ListBuckets',
  'ListMultipartUploads',
  'ListObjects',
  'ListParts',
  'PutBucket',
  'PutBucketCors',
  'PutBucketEncryption',
  'PutBucketLifecycleConfiguration',
  'PutObject',
  'UploadPart',
  'UploadPartCopy',
])
const r2ClassB = new Set([
  'GetBucketCors',
  'GetBucketEncryption',
  'GetBucketLifecycleConfiguration',
  'GetBucketLocation',
  'GetObject',
  'HeadBucket',
  'HeadObject',
  'UsageSummary',
])
const r2Free = new Set(['AbortMultipartUpload', 'DeleteBucket', 'DeleteObject'])
const usageCache = new Map<string, { expiresAt: number, value: Promise<Usage> }>()

export async function storageUsageResponse(request: Request, env: UsageEnv & { NOTES: R2Bucket }) {
  if (isLocalRequest(request)) {
    try {
      return Response.json(await getLocalStorageUsage(env.NOTES), { headers: { 'Cache-Control': 'no-store' } })
    }
    catch {
      return error('usage_unavailable', 503)
    }
  }

  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_USAGE_TOKEN)
    return error('usage_not_configured', 500)

  try {
    const usage = await getUsage(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_USAGE_TOKEN)
    return Response.json({
      usedBytes: usage.r2StorageBytes,
      limitBytes: limits.r2StorageBytes,
      cutoffBytes: limits.r2StorageBytes * CUTOFF,
    } satisfies StorageUsage, { headers: { 'Cache-Control': 'no-store' } })
  }
  catch {
    return error('usage_unavailable', 503)
  }
}

export async function requireFreeTierCapacity(request: Request, env: UsageEnv & { NOTES: R2Bucket }) {
  if (new URL(request.url).pathname === '/api/health')
    return null

  if (isLocalRequest(request)) {
    if (!isMutation(request)) return null
    try {
      const usage = await getLocalStorageUsage(env.NOTES)
      return usage.usedBytes >= usage.cutoffBytes ? limitError('r2_storage') : null
    }
    catch {
      return error('usage_unavailable', 503)
    }
  }

  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_USAGE_TOKEN)
    return error('usage_not_configured', 500)

  try {
    const usage = await getUsage(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_USAGE_TOKEN)
    const limit = blockedLimit(request, usage)
    return limit ? limitError(limit) : null
  }
  catch {
    return error('usage_unavailable', 503)
  }
}

export function blockedLimit(request: Request, usage: Usage) {
  const path = new URL(request.url).pathname
  const sync = request.method === 'GET' && path === '/api/sync'
  const readNote = request.method === 'GET' && path.startsWith('/api/notes/')
  const mutation = isMutation(request)

  if ((sync || mutation) && usage.d1RowsRead >= limits.d1RowsRead * CUTOFF)
    return 'd1_rows_read'
  if ((sync || mutation) && usage.d1RowsWritten >= limits.d1RowsWritten * CUTOFF)
    return 'd1_rows_written'
  if (mutation && usage.d1StorageBytes >= limits.d1StorageBytes * CUTOFF)
    return 'd1_storage'
  if ((sync || mutation) && usage.r2ClassA >= limits.r2ClassA * CUTOFF)
    return 'r2_class_a'
  if ((sync || readNote || mutation) && usage.r2ClassB >= limits.r2ClassB * CUTOFF)
    return 'r2_class_b'
  if (mutation && usage.r2InfrequentBytes > 0)
    return 'r2_infrequent_access'
  if (mutation && usage.r2StorageBytes >= limits.r2StorageBytes * CUTOFF)
    return 'r2_storage'
  return null
}

async function getLocalStorageUsage(bucket: R2Bucket): Promise<StorageUsage> {
  let usedBytes = 0
  let cursor: string | undefined
  do {
    const page = await bucket.list(cursor ? { cursor } : {})
    usedBytes += page.objects.reduce((total, object) => total + object.size, 0)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  const limitBytes = DEFAULT_DEV_R2_STORAGE_LIMIT_BYTES
  return { usedBytes, limitBytes, cutoffBytes: limitBytes * CUTOFF }
}

function isMutation(request: Request) {
  const path = new URL(request.url).pathname
  return (request.method === 'PUT' || request.method === 'DELETE') && path.startsWith('/api/notes/')
}

function limitError(limit: string) {
  return Response.json(
    { error: 'free_tier_limit_near', limit },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function getUsage(accountId: string, token: string) {
  const cached = usageCache.get(accountId)
  if (cached && cached.expiresAt > Date.now())
    return cached.value

  const value = loadUsage(accountId, token)
  usageCache.set(accountId, { expiresAt: Date.now() + CACHE_MS, value })
  try {
    return await value
  }
  catch (cause) {
    usageCache.delete(accountId)
    throw cause
  }
}

async function loadUsage(accountId: string, token: string): Promise<Usage> {
  const headers = { Authorization: `Bearer ${token}` }
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const r2Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const [analytics, databases, r2Metrics] = await Promise.all([
    fetchAnalytics(accountId, token, today, r2Start, now.toISOString()),
    cloudflare<{ uuid?: string }[]>(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database?per_page=10000`,
      headers,
    ),
    cloudflare<R2Metrics>(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/metrics`,
      headers,
    ),
  ])
  const databaseSizes = await Promise.all(databases.map(database => database.uuid
    ? cloudflare<{ file_size?: number }>(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${database.uuid}?fields=file_size`,
        headers,
      )
    : Promise.reject(new Error('D1 database has no ID'))))

  const d1RowsRead = analytics.d1.reduce((total, group) => total + (group.sum.rowsRead ?? 0), 0)
  const d1RowsWritten = analytics.d1.reduce((total, group) => total + (group.sum.rowsWritten ?? 0), 0)
  let classA = 0
  let classB = 0
  for (const group of analytics.r2) {
    const action = group.dimensions.actionType
    if (r2ClassA.has(action))
      classA += group.sum.requests ?? 0
    else if (r2ClassB.has(action))
      classB += group.sum.requests ?? 0
    else if (!r2Free.has(action))
      throw new Error(`Unknown R2 operation: ${action}`)
  }

  const standard = storageBytes(r2Metrics.standard)
  const infrequent = storageBytes(r2Metrics.infrequentAccess)
  return {
    d1RowsRead,
    d1RowsWritten,
    d1StorageBytes: databaseSizes.reduce((total, database) => total + (database.file_size ?? 0), 0),
    r2ClassA: classA,
    r2ClassB: classB,
    r2StorageBytes: standard + infrequent,
    r2InfrequentBytes: infrequent,
  }
}

async function fetchAnalytics(accountId: string, token: string, today: string, r2Start: string, now: string) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query Usage($accountTag: string!, $today: Date!, $r2Start: Time!, $now: Time!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            d1: d1AnalyticsAdaptiveGroups(
              limit: 10000
              filter: { date_geq: $today, date_leq: $today }
            ) {
              sum { rowsRead rowsWritten }
            }
            r2: r2OperationsAdaptiveGroups(
              limit: 10000
              filter: { datetime_geq: $r2Start, datetime_leq: $now }
            ) {
              sum { requests }
              dimensions { actionType }
            }
          }
        }
      }`,
      variables: { accountTag: accountId, today, r2Start, now },
    }),
  })
  const body = await response.json() as {
    data?: { viewer: { accounts: Analytics[] } }
    errors?: unknown[]
  }
  if (!response.ok || body.errors?.length || body.data?.viewer.accounts.length !== 1)
    throw new Error('Cloudflare Analytics request failed')
  return body.data.viewer.accounts[0]
}

async function cloudflare<T>(url: string, headers: HeadersInit) {
  const response = await fetch(url, { headers })
  const body = await response.json() as { success: boolean, result: T }
  if (!response.ok || !body.success)
    throw new Error('Cloudflare API request failed')
  return body.result
}

function storageBytes(metrics?: R2StorageClass) {
  return (metrics?.published?.payloadSize ?? 0)
    + (metrics?.published?.metadataSize ?? 0)
    + (metrics?.uploaded?.payloadSize ?? 0)
    + (metrics?.uploaded?.metadataSize ?? 0)
}

function error(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

type Analytics = {
  d1: { sum: { rowsRead?: number, rowsWritten?: number } }[]
  r2: { dimensions: { actionType: string }, sum: { requests?: number } }[]
}

type R2StorageClass = {
  published?: { metadataSize?: number, payloadSize?: number }
  uploaded?: { metadataSize?: number, payloadSize?: number }
}

type R2Metrics = {
  infrequentAccess?: R2StorageClass
  standard?: R2StorageClass
}
