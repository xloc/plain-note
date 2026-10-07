import { waitUntil } from 'cloudflare:workers'
import type {
  DeleteNoteRequest,
  EncryptedNote,
  PutEncryptedNoteRequest,
  RebuildVaultRequest,
  RemoteConflictResponse,
  RemoteNoteRecord,
  SyncGateToken,
  SyncWaitResponse,
  Tombstone,
} from '../shared/note'
import {
  accessLogin,
  createAppSession,
  type AuthEnv,
  requireAppSession,
  requireSameOrigin,
  revokeOtherSessions,
  sessionApi,
} from './auth'
import { getChanges, rebuildIndex, recordChange } from './index-db'
import { approveCli, exchangeCli } from './cli-auth'
import { clearCleanupFailure, recordCleanupFailure } from './issues'
import { json } from './response'
import { notifySyncGate, SyncGate, type SyncGateEnv, waitForSyncGate } from './sync-gate'
import {
  cleanupExpiredResources,
  clearNotes,
  getRecord,
  getResource,
  putNote,
  putResource,
  putTombstone,
} from './storage'
import { requireFreeTierCapacity, storageStatusResponse, type UsageEnv } from './usage'
import { isVaultKeyId, matchesVaultKey, replaceVaultKey, requireVaultKey } from './vault'

type Env = AuthEnv &
  SyncGateEnv &
  UsageEnv & {
    ASSETS: Fetcher
    DB: D1Database
    NOTES: R2Bucket
  }

export { SyncGate }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    const originError = requireSameOrigin(request)
    if (originError) return originError

    try {
      if (request.method === 'GET' && url.pathname === '/api/auth/login') {
        return accessLogin(request)
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/session') {
        return await createAppSession(request, env)
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/cli/exchange') {
        return await exchangeCli(request, env.DB)
      }
      const session = await requireAppSession(request, env)
      if (session instanceof Response) return session
      if (request.method === 'POST' && url.pathname === '/api/auth/cli/approve') {
        return await approveCli(request, env.DB, session.id)
      }
      if (url.pathname.startsWith('/api/auth/')) return await sessionApi(request, env, url, session)
      return await api(request, env, url, session.id)
    } catch (error) {
      console.error(error)
      return json({ error: 'internal_error' }, 500)
    }
  },
  async scheduled(_controller, env) {
    try {
      await cleanupExpiredResources(env.NOTES)
      await clearCleanupFailure(env.DB)
    } catch (error) {
      console.error('Scheduled resource cleanup failed', error)
      try {
        await recordCleanupFailure(env.DB)
      } catch (issueError) {
        console.error('Recording the cleanup failure failed', issueError)
      }
      throw error
    }
  },
} satisfies ExportedHandler<Env>

async function api(request: Request, env: Env, url: URL, sessionId: string) {
  if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true })
  if (request.method === 'GET' && url.pathname === '/api/storage') return storageStatusResponse(request, env)

  const usageError = await requireFreeTierCapacity(request, env)
  if (usageError) return usageError

  if (request.method === 'POST' && url.pathname === '/api/vault/rebuild') return rebuildVault(request, env, sessionId)

  const vaultError = await requireVaultKey(request, env.NOTES)
  if (vaultError) return vaultError

  if (request.method === 'GET' && url.pathname === '/api/sync') {
    const after = Number(url.searchParams.get('after') ?? 0)
    const generation = url.searchParams.get('generation')
    const cursor = Number.isFinite(after) ? after : 0
    if (!url.searchParams.has('wait')) return json(await getChanges(env, generation, cursor))

    const gate = await waitForSyncGate(env, syncGateToken(url))
    const changes = await getChanges(env, generation, cursor)
    return json({ changed: changes.reset || changes.changes.length > 0, gate } satisfies SyncWaitResponse)
  }

  const resourceMatch = url.pathname.match(/^\/api\/notes\/([A-Za-z0-9_-]+)\/resources\/([A-Za-z0-9_-]+)$/)
  if (resourceMatch) {
    const [, noteId, resourceId] = resourceMatch
    if (request.method === 'GET') return readResource(env, noteId, resourceId)
    if (request.method === 'PUT') return writeResource(request, env, noteId, resourceId)
    return json({ error: 'method_not_allowed' }, 405)
  }

  const noteMatch = url.pathname.match(/^\/api\/notes\/([A-Za-z0-9_-]+)$/)
  if (!noteMatch) return json({ error: 'not_found' }, 404)

  const id = noteMatch[1]
  if (request.method === 'GET') return readNote(env, id)
  if (request.method === 'PUT') return notifyAfter(writeNote(request, env, id), request, env)
  if (request.method === 'DELETE') return notifyAfter(deleteNote(request, env, id), request, env)

  return json({ error: 'method_not_allowed' }, 405)
}

async function rebuildVault(request: Request, env: Env, sessionId: string) {
  const value = await request.json<unknown>()
  if (!value || typeof value !== 'object' || !isVaultKeyId((value as Partial<RebuildVaultRequest>).keyId)) {
    return json({ error: 'invalid_vault_key' }, 400)
  }
  const body = value as RebuildVaultRequest
  const vaultError = await requireVaultKey(request, env.NOTES)
  if (vaultError) {
    // A lost success response must be retryable after the server has already installed the new key.
    if (await matchesVaultKey(env.NOTES, body.keyId)) {
      waitUntil(notifySyncGate(request, env))
      return json({ ok: true })
    }
    return vaultError
  }

  // Stop other browsers from uploading stale data while this device replaces the cloud copy.
  await revokeOtherSessions(env.DB, sessionId)
  // Keep the old key active until the replaceable cloud copy has been cleared successfully.
  await clearNotes(env.NOTES)
  await rebuildIndex(env)
  await clearCleanupFailure(env.DB)
  await replaceVaultKey(env.NOTES, body.keyId)
  waitUntil(notifySyncGate(request, env))
  return json({ ok: true })
}

async function notifyAfter(result: Promise<Response>, request: Request, env: Env) {
  const response = await result
  if (response.ok) waitUntil(notifySyncGate(request, env))
  return response
}

function syncGateToken(url: URL): SyncGateToken | null {
  const generation = url.searchParams.get('gateGeneration')
  const version = Number(url.searchParams.get('gateVersion'))
  return generation && Number.isSafeInteger(version) && version >= 0 ? { generation, version } : null
}

async function readNote(env: Env, id: string) {
  const stored = await getRecord(env.NOTES, id)
  if (!stored) return json({ error: 'not_found' }, 404)
  if ('deleted' in stored.record) return json({ error: 'deleted', current: stored.record }, 410)
  return json({ note: stored.record })
}

async function readResource(env: Env, noteId: string, id: string) {
  const object = await getResource(env.NOTES, noteId, id)
  if (!object) return json({ error: 'not_found' }, 404)

  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Length': String(object.size),
    'Content-Type': 'application/octet-stream',
  })
  return new Response(object.body, { headers })
}

async function writeResource(request: Request, env: Env, noteId: string, id: string) {
  if (!request.body) return json({ error: 'invalid_resource' }, 400)
  await putResource(env.NOTES, noteId, id, request.body)
  return json({ ok: true })
}

async function writeNote(request: Request, env: Env, id: string) {
  const value = await request.json<unknown>()
  if (!isPutNoteRequest(value, id)) return json({ error: 'invalid_note' }, 400)
  const body = value

  const current = await getRecord(env.NOTES, id)
  // Idempotent retries repair a derived index write that failed after the R2 commit.
  if (current?.record.revision === body.note.revision && !('deleted' in current.record)) {
    await recordChange(env, current.record, current.etag)
    return json({ note: current.record })
  }
  if ((current?.record.revision ?? null) !== body.baseRevision) return conflict(current?.record ?? null)

  const stored = await putNote(env.NOTES, body.note, current?.etag ?? null)
  if (!stored) return conflict((await getRecord(env.NOTES, id))?.record ?? null)

  await recordChange(env, body.note, stored.etag)
  return json({ note: body.note })
}

async function deleteNote(request: Request, env: Env, id: string) {
  const value = await request.json<unknown>()
  if (!isDeleteNoteRequest(value)) return json({ error: 'invalid_note' }, 400)
  const body = value
  const current = await getRecord(env.NOTES, id)
  if (!current) return json({ error: 'not_found' }, 404)

  // Idempotent retries repair a derived index write that failed after the R2 commit.
  if ('deleted' in current.record && current.record.revision === body.revision) {
    await recordChange(env, current.record, current.etag)
    return json({ tombstone: current.record })
  }
  if (current.record.revision !== body.baseRevision) return conflict(current.record)
  if (body.revision === body.baseRevision) return json({ error: 'invalid_revision' }, 400)

  const tombstone: Tombstone = {
    id,
    deleted: true,
    revision: body.revision,
    updatedAt: body.updatedAt,
  }
  const stored = await putTombstone(env.NOTES, tombstone, current.etag)
  if (!stored) return conflict((await getRecord(env.NOTES, id))?.record ?? null)

  await recordChange(env, tombstone, stored.etag)
  return json({ tombstone })
}

function conflict(current: RemoteNoteRecord | null) {
  if (!current) return json({ error: 'not_found' }, 404)
  return json({ error: 'conflict', current } satisfies RemoteConflictResponse, 409)
}

function isPutNoteRequest(value: unknown, id: string): value is PutEncryptedNoteRequest {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<PutEncryptedNoteRequest>
  const baseRevision = body.baseRevision
  return (
    (baseRevision === null || typeof baseRevision === 'string') &&
    isEncryptedNote(body.note) &&
    body.note.id === id &&
    body.note.revision !== baseRevision
  )
}

function isDeleteNoteRequest(value: unknown): value is DeleteNoteRequest {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<DeleteNoteRequest>
  return (
    typeof body.baseRevision === 'string' &&
    typeof body.revision === 'string' &&
    body.revision !== body.baseRevision &&
    isTimestamp(body.updatedAt)
  )
}

function isEncryptedNote(note: EncryptedNote | undefined): note is EncryptedNote {
  // These clear fields drive synchronization and cleanup, so validate them at the API boundary.
  return Boolean(
    note &&
    typeof note.id === 'string' &&
    typeof note.revision === 'string' &&
    isTimestamp(note.updatedAt) &&
    Array.isArray(note.resourceIds) &&
    note.resourceIds.every((id) => typeof id === 'string') &&
    typeof note.encrypted === 'string',
  )
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
