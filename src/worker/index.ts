import type {
  ConflictResponse,
  DeleteNoteRequest,
  Note,
  PutNoteRequest,
  Tombstone,
} from '../shared/note'
import { type AuthEnv, requireAccess } from './auth'
import { getChanges, recordChange } from './index-db'
import { getRecord, putNote, putTombstone } from './storage'

type Env = AuthEnv & {
  ASSETS: Fetcher
  DB: D1Database
  NOTES: R2Bucket
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/'))
      return env.ASSETS.fetch(request)

    const authError = await requireAccess(request, env)
    if (authError)
      return authError

    try {
      return await api(request, env, url)
    }
    catch (error) {
      console.error(error)
      return json({ error: 'internal_error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>

async function api(request: Request, env: Env, url: URL) {
  if (request.method === 'GET' && url.pathname === '/api/health')
    return json({ ok: true })

  if (request.method === 'GET' && url.pathname === '/api/sync') {
    const after = Number(url.searchParams.get('after') ?? 0)
    const generation = url.searchParams.get('generation')
    return json(await getChanges(env, generation, Number.isFinite(after) ? after : 0))
  }

  const match = url.pathname.match(/^\/api\/notes\/([A-Za-z0-9_-]+)$/)
  if (!match)
    return json({ error: 'not_found' }, 404)

  const id = match[1]
  if (request.method === 'GET')
    return readNote(env, id)
  if (request.method === 'PUT')
    return writeNote(request, env, id)
  if (request.method === 'DELETE')
    return deleteNote(request, env, id)

  return json({ error: 'method_not_allowed' }, 405)
}

async function readNote(env: Env, id: string) {
  const stored = await getRecord(env.NOTES, id)
  if (!stored)
    return json({ error: 'not_found' }, 404)
  if ('deleted' in stored.record)
    return json({ error: 'deleted', current: stored.record }, 410)
  return json({ note: stored.record })
}

async function writeNote(request: Request, env: Env, id: string) {
  const body = await request.json<PutNoteRequest>()
  if (body.note.id !== id || body.note.revision === body.baseRevision)
    return json({ error: 'invalid_note' }, 400)

  const current = await getRecord(env.NOTES, id)
  if (current?.record.revision === body.note.revision && !('deleted' in current.record)) {
    await recordChange(env, current.record, current.etag)
    return json({ note: current.record })
  }
  if ((current?.record.revision ?? null) !== body.baseRevision)
    return conflict(current?.record ?? null)

  const stored = await putNote(env.NOTES, body.note, current?.etag ?? null)
  if (!stored)
    return conflict((await getRecord(env.NOTES, id))?.record ?? null)

  await recordChange(env, body.note, stored.etag)
  return json({ note: body.note })
}

async function deleteNote(request: Request, env: Env, id: string) {
  const body = await request.json<DeleteNoteRequest>()
  const current = await getRecord(env.NOTES, id)
  if (!current)
    return json({ error: 'not_found' }, 404)

  if ('deleted' in current.record && current.record.revision === body.revision) {
    await recordChange(env, current.record, current.etag)
    return json({ tombstone: current.record })
  }
  if (current.record.revision !== body.baseRevision)
    return conflict(current.record)
  if (body.revision === body.baseRevision)
    return json({ error: 'invalid_revision' }, 400)

  const tombstone: Tombstone = {
    id,
    deleted: true,
    revision: body.revision,
    updatedAt: body.updatedAt,
  }
  const stored = await putTombstone(env.NOTES, tombstone, current.etag)
  if (!stored)
    return conflict((await getRecord(env.NOTES, id))?.record ?? null)

  await recordChange(env, tombstone, stored.etag)
  return json({ tombstone })
}

function conflict(current: Note | Tombstone | null) {
  if (!current)
    return json({ error: 'not_found' }, 404)
  return json({ error: 'conflict', current } satisfies ConflictResponse, 409)
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
