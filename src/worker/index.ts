import type { ConflictResponse, DeleteNoteRequest, Note, NoteResource, PutNoteRequest, Tombstone } from '../shared/note'
import { createAppSession, type AuthEnv, requireAppSession, requireSameOrigin, sessionApi } from './auth'
import { getChanges, recordChange } from './index-db'
import {
  cleanupExpiredResources,
  cleanupResources,
  deleteResource,
  getRecord,
  getResource,
  putNote,
  putResource,
  putTombstone,
} from './storage'
import { requireFreeTierCapacity, storageUsageResponse, type UsageEnv } from './usage'

type Env = AuthEnv &
  UsageEnv & {
    ASSETS: Fetcher
    DB: D1Database
    NOTES: R2Bucket
  }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    const originError = requireSameOrigin(request)
    if (originError) return originError

    try {
      if (request.method === 'POST' && url.pathname === '/api/auth/session') {
        return await createAppSession(request, env)
      }
      const session = await requireAppSession(request, env)
      if (session instanceof Response) return session
      if (url.pathname.startsWith('/api/auth/')) return await sessionApi(request, env, url, session)
      return await api(request, env, url)
    } catch (error) {
      console.error(error)
      return json({ error: 'internal_error' }, 500)
    }
  },
  async scheduled(_controller, env) {
    await cleanupExpiredResources(env.NOTES)
  },
} satisfies ExportedHandler<Env>

async function api(request: Request, env: Env, url: URL) {
  if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true })
  if (request.method === 'GET' && url.pathname === '/api/usage') return storageUsageResponse(request, env)

  const usageError = await requireFreeTierCapacity(request, env)
  if (usageError) return usageError

  if (request.method === 'GET' && url.pathname === '/api/sync') {
    const after = Number(url.searchParams.get('after') ?? 0)
    const generation = url.searchParams.get('generation')
    return json(await getChanges(env, generation, Number.isFinite(after) ? after : 0))
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
  if (request.method === 'PUT') return writeNote(request, env, id)
  if (request.method === 'DELETE') return deleteNote(request, env, id)

  return json({ error: 'method_not_allowed' }, 405)
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
    'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
  })
  return new Response(object.body, { headers })
}

async function writeResource(request: Request, env: Env, noteId: string, id: string) {
  if (!request.body) return json({ error: 'invalid_resource' }, 400)

  const encodedName = request.headers.get('X-Resource-Name')
  const size = Number(request.headers.get('X-Resource-Size'))
  const createdAt = Number(request.headers.get('X-Resource-Created-At'))
  if (!encodedName || !Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(createdAt))
    return json({ error: 'invalid_resource' }, 400)

  let name: string
  try {
    name = decodeURIComponent(encodedName)
  } catch {
    return json({ error: 'invalid_resource' }, 400)
  }

  const resource: NoteResource = {
    id,
    name,
    mime: request.headers.get('Content-Type') ?? 'application/octet-stream',
    size,
    createdAt,
  }
  const stored = await putResource(env.NOTES, noteId, resource, request.body)
  if (!stored) {
    // Idempotent retry: accept the existing object only when its metadata matches.
    const existing = await getResource(env.NOTES, noteId, id)
    const same =
      existing?.size === resource.size &&
      existing.httpMetadata?.contentType === resource.mime &&
      existing.customMetadata?.name === encodeURIComponent(resource.name) &&
      existing.customMetadata?.createdAt === String(resource.createdAt)
    if (!same) return json({ error: 'resource_conflict' }, 409)
  } else if (stored.size !== resource.size) {
    await deleteResource(env.NOTES, noteId, id)
    return json({ error: 'invalid_resource' }, 400)
  }
  return json({ resource })
}

async function writeNote(request: Request, env: Env, id: string) {
  const body = await request.json<PutNoteRequest>()
  if (body.note.id !== id || body.note.revision === body.baseRevision) return json({ error: 'invalid_note' }, 400)

  const current = await getRecord(env.NOTES, id)
  // Idempotent retry: repeat indexing and cleanup before returning the stored result.
  if (current?.record.revision === body.note.revision && !('deleted' in current.record)) {
    await recordChange(env, current.record, current.etag)
    await cleanupResources(
      env.NOTES,
      id,
      current.record.resources.map((resource) => resource.id),
    )
    return json({ note: current.record })
  }
  if ((current?.record.revision ?? null) !== body.baseRevision) return conflict(current?.record ?? null)

  const stored = await putNote(env.NOTES, body.note, current?.etag ?? null)
  if (!stored) return conflict((await getRecord(env.NOTES, id))?.record ?? null)

  await recordChange(env, body.note, stored.etag)
  const previousIds =
    current && !('deleted' in current.record) ? current.record.resources.map((resource) => resource.id) : []
  const resourceIds = body.note.resources.map((resource) => resource.id)
  await cleanupResources(
    env.NOTES,
    id,
    resourceIds,
    previousIds.filter((resourceId) => !resourceIds.includes(resourceId)),
  )
  return json({ note: body.note })
}

async function deleteNote(request: Request, env: Env, id: string) {
  const body = await request.json<DeleteNoteRequest>()
  const current = await getRecord(env.NOTES, id)
  if (!current) return json({ error: 'not_found' }, 404)

  // Idempotent retry: repeat indexing and cleanup before returning the stored tombstone.
  if ('deleted' in current.record && current.record.revision === body.revision) {
    await recordChange(env, current.record, current.etag)
    await cleanupResources(env.NOTES, id, [])
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
  const previousIds = 'deleted' in current.record ? [] : current.record.resources.map((resource) => resource.id)
  await cleanupResources(env.NOTES, id, [], previousIds)
  return json({ tombstone })
}

function conflict(current: Note | Tombstone | null) {
  if (!current) return json({ error: 'not_found' }, 404)
  return json({ error: 'conflict', current } satisfies ConflictResponse, 409)
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
