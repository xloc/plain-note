import { base64 } from '../shared/base.ts'
import type { CliAuthorization } from '../shared/auth.ts'
import { ensureSchema, issueSession } from './auth.ts'
import { error, json } from './response.ts'

const GRANT_MS = 5 * 60 * 1000
const secretPattern = /^[A-Za-z0-9_-]{43}$/
const idPattern = /^[0-9a-f-]{36}$/

async function ensureGrants(db: D1Database) {
  await ensureSchema(db)
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS cli_grants (
    id TEXT PRIMARY KEY, challenge TEXT NOT NULL, name TEXT NOT NULL,
    session_id TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0
  )`)
    .run()
}

export async function approveCli(request: Request, db: D1Database, sessionId: string) {
  const body = await request.json<CliAuthorization>()
  if (
    !body ||
    !idPattern.test(body.id ?? '') ||
    !secretPattern.test(body.challenge ?? '') ||
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.length > 100
  ) {
    return error('invalid_cli_authorization', 400)
  }
  await ensureGrants(db)
  await db.prepare('DELETE FROM cli_grants WHERE expires_at <= ?').bind(Date.now()).run()
  const result = await db
    .prepare(`INSERT INTO cli_grants (id, challenge, name, session_id, expires_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id`)
    .bind(body.id, body.challenge, body.name.trim(), sessionId, Date.now() + GRANT_MS)
    .first()
  return result ? json({ ok: true }) : error('cli_authorization_already_approved', 409)
}

export async function exchangeCli(request: Request, db: D1Database) {
  const body = await request.json<{ id: string; verifier: string }>()
  if (!body || !idPattern.test(body.id ?? '') || !secretPattern.test(body.verifier ?? '')) {
    return error('invalid_cli_authorization', 400)
  }
  await ensureGrants(db)
  const challenge = base64.encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.verifier)))
  // Consuming the grant is atomic. Only the CLI holding the original verifier can redeem it.
  const grant = await db
    .prepare(`UPDATE cli_grants SET consumed = 1
    WHERE id = ? AND challenge = ? AND consumed = 0 AND expires_at > ?
      AND EXISTS (SELECT 1 FROM auth_sessions WHERE auth_sessions.id = cli_grants.session_id
        AND revoked_at IS NULL AND expires_at > ?)
    RETURNING name`)
    .bind(body.id, challenge, Date.now(), Date.now())
    .first<{ name: string }>()
  return grant ? json(await issueSession(db, grant.name)) : json({ pending: true }, 202)
}
