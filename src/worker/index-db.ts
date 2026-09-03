import type { Change, NoteRecord, SyncResponse } from '../shared/note'
import { getRecord } from './storage'

const SCHEMA_VERSION = '2'

type Env = {
  DB: D1Database
  NOTES: R2Bucket
}

export async function ensureIndex(env: Env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run()

  const rows = await env.DB.prepare(
    "SELECT key, value FROM index_meta WHERE key IN ('schema_version', 'generation')",
  ).all<{ key: string; value: string }>()
  const meta = Object.fromEntries(rows.results.map((row) => [row.key, row.value]))

  if (meta.schema_version === SCHEMA_VERSION && meta.generation) return meta.generation

  return rebuildIndex(env)
}

export async function rebuildIndex(env: Env) {
  await env.DB.batch([
    env.DB.prepare('DROP TABLE IF EXISTS changes'),
    env.DB.prepare('DROP TABLE IF EXISTS note_index'),
    env.DB.prepare(`CREATE TABLE note_index (
      id TEXT PRIMARY KEY,
      revision TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL,
      r2_etag TEXT NOT NULL,
      last_seq INTEGER NOT NULL
    )`),
  ])

  let cursor: string | undefined
  do {
    const page = await env.NOTES.list({ prefix: 'notes/', cursor })
    const noteObjects = page.objects.filter((object) => object.key.endsWith('/note.md'))
    const records = await Promise.all(
      noteObjects.map(async (object) => {
        const id = object.key.slice('notes/'.length, -'/note.md'.length)
        return { stored: await getRecord(env.NOTES, id), id }
      }),
    )
    const statements = records.flatMap(({ stored, id }) =>
      stored ? [indexStatement(env.DB, id, stored.record, stored.etag)] : [],
    )
    if (statements.length) await env.DB.batch(statements)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  const generation = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare("DELETE FROM index_meta WHERE key IN ('schema_version', 'generation')"),
    env.DB.prepare('INSERT INTO index_meta (key, value) VALUES (?, ?)').bind('schema_version', SCHEMA_VERSION),
    env.DB.prepare('INSERT INTO index_meta (key, value) VALUES (?, ?)').bind('generation', generation),
  ])
  return generation
}

export async function recordChange(env: Env, record: NoteRecord, etag: string) {
  await ensureIndex(env)
  await env.DB.prepare(`
    INSERT INTO note_index (id, revision, updated_at, deleted, r2_etag, last_seq)
    VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(last_seq), 0) + 1 FROM note_index))
    ON CONFLICT(id) DO UPDATE SET
      revision = excluded.revision,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted,
      r2_etag = excluded.r2_etag,
      last_seq = excluded.last_seq
    WHERE note_index.revision != excluded.revision
  `)
    .bind(record.id, record.revision, record.updatedAt, 'deleted' in record ? 1 : 0, etag)
    .run()
}

export async function getChanges(env: Env, clientGeneration: string | null, after: number): Promise<SyncResponse> {
  const generation = await ensureIndex(env)

  if (clientGeneration !== generation) {
    const snapshot = await env.DB.prepare(`
      SELECT 0 AS seq, id, revision, updated_at AS updatedAt,
        CASE deleted WHEN 1 THEN 'delete' ELSE 'put' END AS operation
      FROM note_index
      ORDER BY updated_at, id
    `).all<Change>()
    return { generation, reset: true, cursor: 0, changes: snapshot.results }
  }

  const result = await env.DB.prepare(`
    SELECT last_seq AS seq, id, revision, updated_at AS updatedAt,
      CASE deleted WHEN 1 THEN 'delete' ELSE 'put' END AS operation
    FROM note_index
    WHERE last_seq > ?
    ORDER BY last_seq
    LIMIT 500
  `)
    .bind(after)
    .all<Change>()
  const cursor = result.results.at(-1)?.seq ?? after
  return { generation, reset: false, cursor, changes: result.results }
}

function indexStatement(db: D1Database, id: string, record: NoteRecord, etag: string) {
  return db
    .prepare(`
    INSERT INTO note_index (id, revision, updated_at, deleted, r2_etag, last_seq)
    VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET
      revision = excluded.revision,
      updated_at = excluded.updated_at,
      deleted = excluded.deleted,
      r2_etag = excluded.r2_etag,
      last_seq = excluded.last_seq
  `)
    .bind(id, record.revision, record.updatedAt, 'deleted' in record ? 1 : 0, etag)
}
