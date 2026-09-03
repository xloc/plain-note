import { createRemoteJWKSet, jwtVerify } from 'jose'
import { CLIENT_SESSION_COOKIE, CLIENT_SESSION_HEADER, SESSION_COOKIE, type AuthStatus } from '../shared/auth.ts'
import { isLocalRequest } from './environment.ts'

export type AuthEnv = {
  POLICY_AUD?: string
  TEAM_DOMAIN?: string
  TEST_AUTH_BYPASS?: boolean
}

type AccessIdentity = {
  sub: string
}

export type AppSessionIdentity = {
  id: string
}

const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
const initializedDatabases = new WeakSet<object>()

type Env = AuthEnv & { DB: D1Database }

export async function createAppSession(request: Request, env: Env) {
  const identity = await authenticateAccess(request, env)
  if (identity instanceof Response) return identity
  await ensureSchema(env.DB)

  const body = await request.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name || name.length > 100) return error('invalid_session', 400)

  const id = crypto.randomUUID()
  const token = randomToken()
  const clientKey = randomToken()
  const now = Date.now()
  await env.DB.prepare(`INSERT INTO auth_sessions (id, token_hash, client_key_hash, name, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, await hash(token), await hash(clientKey), name, now, now + SESSION_MS)
    .run()

  return setSessionCookies(json({ ok: true }), request, token, clientKey, SESSION_MS / 1000)
}

export async function requireAppSession(request: Request, env: Env): Promise<AppSessionIdentity | Response> {
  if (isLocalRequest(request) && env.TEST_AUTH_BYPASS) return { id: 'test' }
  await ensureSchema(env.DB)

  const token = cookie(request, SESSION_COOKIE)
  const clientKey = cookie(request, CLIENT_SESSION_COOKIE) ?? logoutClientKey(request)
  if (!token || !clientKey) return clearSessionCookies(error('session_required', 401), request)
  const row = await env.DB.prepare(`SELECT auth_sessions.id
    FROM auth_sessions
    WHERE auth_sessions.token_hash = ?
      AND auth_sessions.client_key_hash = ?
      AND auth_sessions.revoked_at IS NULL
      AND auth_sessions.expires_at > ?`)
    .bind(await hash(token), await hash(clientKey), Date.now())
    .first<AppSessionIdentity>()
  return row ?? clearSessionCookies(error('session_required', 401), request)
}

export async function sessionApi(request: Request, env: Env, url: URL, session: AppSessionIdentity) {
  if (request.method === 'GET' && url.pathname === '/api/auth/status') {
    return json(await sessionStatus(env.DB, session))
  }

  const sessionMatch = url.pathname.match(/^\/api\/auth\/sessions\/([0-9a-f-]{36})$/)
  if (request.method === 'DELETE' && sessionMatch) {
    const id = sessionMatch[1]
    await env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ?
      WHERE id = ? AND revoked_at IS NULL`)
      .bind(Date.now(), id)
      .run()
    const response = json({ ok: true })
    return id === session.id ? clearSessionCookies(response, request) : response
  }

  if (request.method === 'DELETE' && url.pathname === '/api/auth/sessions') {
    await env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ?
      WHERE revoked_at IS NULL`)
      .bind(Date.now())
      .run()
    return clearSessionCookies(json({ ok: true }), request)
  }

  return error('not_found', 404)
}

export function requireSameOrigin(request: Request) {
  if (isLocalRequest(request) || request.method === 'GET' || request.method === 'HEAD') return null
  return request.headers.get('Origin') === new URL(request.url).origin ? null : error('invalid_origin', 403)
}

async function authenticateAccess(request: Request, env: AuthEnv): Promise<AccessIdentity | Response> {
  if (isLocalRequest(request)) return { sub: 'local' }

  if (!env.POLICY_AUD || !env.TEAM_DOMAIN) return error('auth_not_configured', 500)

  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) return error('unauthorized', 401)

  try {
    let keySet = keySets.get(env.TEAM_DOMAIN)
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', env.TEAM_DOMAIN))
      keySets.set(env.TEAM_DOMAIN, keySet)
    }
    const { payload } = await jwtVerify(token, keySet, {
      algorithms: ['RS256'],
      audience: env.POLICY_AUD,
      issuer: env.TEAM_DOMAIN,
    })
    if (typeof payload.sub !== 'string') return error('unauthorized', 401)
    return { sub: payload.sub }
  } catch {
    return error('unauthorized', 401)
  }
}

async function sessionStatus(db: D1Database, session: AppSessionIdentity): Promise<AuthStatus> {
  const rows = await db
    .prepare(`SELECT id, name, created_at AS createdAt, expires_at AS expiresAt
    FROM auth_sessions
    WHERE auth_sessions.revoked_at IS NULL
      AND auth_sessions.expires_at > ?
    ORDER BY auth_sessions.created_at`)
    .bind(Date.now())
    .all<{
      id: string
      name: string
      createdAt: number
      expiresAt: number
    }>()
  return {
    currentSessionId: session.id,
    sessions: rows.results.map((row) => ({ ...row, current: row.id === session.id })),
  }
}

async function ensureSchema(db: D1Database) {
  if (initializedDatabases.has(db)) return
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, client_key_hash TEXT NOT NULL, name TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER)`)
    .run()

  const columns = await db.prepare('PRAGMA table_info(auth_sessions)').all<{ name: string }>()
  if (!columns.results.some((column) => column.name === 'name')) {
    await db.prepare('ALTER TABLE auth_sessions ADD COLUMN name TEXT').run()
  }
  if (!columns.results.some((column) => column.name === 'client_key_hash')) {
    await db.prepare('ALTER TABLE auth_sessions ADD COLUMN client_key_hash TEXT').run()
  }
  if (columns.results.some((column) => column.name === 'device_id')) {
    await db
      .prepare(`UPDATE auth_sessions SET name = COALESCE(
      (SELECT name FROM auth_devices WHERE auth_devices.id = auth_sessions.device_id), 'Browser')
      WHERE name IS NULL`)
      .run()
    await db.prepare('ALTER TABLE auth_sessions DROP COLUMN device_id').run()
  } else {
    await db.prepare("UPDATE auth_sessions SET name = 'Browser' WHERE name IS NULL").run()
  }
  initializedDatabases.add(db)
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64url(digest)
}

function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

function base64url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function cookie(request: Request, name: string) {
  return request.headers
    .get('Cookie')
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function logoutClientKey(request: Request) {
  const path = new URL(request.url).pathname
  return request.method === 'DELETE' && /^\/api\/auth\/sessions(?:\/[0-9a-f-]{36})?$/.test(path)
    ? request.headers.get(CLIENT_SESSION_HEADER)
    : null
}

function setSessionCookies(response: Response, request: Request, token: string, clientKey: string, maxAge: number) {
  response.headers.append('Set-Cookie', cookieValue(request, SESSION_COOKIE, token, maxAge, true))
  response.headers.append('Set-Cookie', cookieValue(request, CLIENT_SESSION_COOKIE, clientKey, maxAge, false))
  return response
}

function clearSessionCookies(response: Response, request: Request) {
  response.headers.append('Set-Cookie', cookieValue(request, SESSION_COOKIE, '', 0, true))
  response.headers.append('Set-Cookie', cookieValue(request, CLIENT_SESSION_COOKIE, '', 0, false))
  return response
}

function cookieValue(request: Request, name: string, value: string, maxAge: number, httpOnly: boolean) {
  const secure = isLocalRequest(request) ? '' : '; Secure'
  return `${name}=${value}${httpOnly ? '; HttpOnly' : ''}; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`
}

function error(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}
