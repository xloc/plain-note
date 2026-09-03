import assert from 'node:assert/strict'
import test from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createAppSession, requireAppSession, requireSameOrigin, sessionApi } from './auth.ts'

test('creates and requires a real app session locally', async () => {
  const DB = new MemoryDatabase()
  const env = { DB }
  const missing = await requireAppSession(new Request('http://localhost:8787/api/health'), env)
  assert.equal(missing.status, 401)

  const created = await createAppSession(
    new Request('http://localhost:8787/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Local browser' }),
    }),
    env,
  )
  const setCookie = created.headers.get('Set-Cookie')
  assert.doesNotMatch(setCookie, /; Secure/)
  const token = setCookie.match(/PlainNoteSession=([^;]+)/)[1]
  const clientKey = setCookie.match(/PlainNoteClientSession=([^;]+)/)[1]
  assert.deepEqual(await created.json(), { ok: true })

  const cookieOnly = await requireAppSession(
    new Request('http://localhost:8787/api/health', {
      headers: { Cookie: `PlainNoteSession=${token}` },
    }),
    env,
  )
  assert.equal(cookieOnly.status, 401)

  const session = await requireAppSession(
    new Request('http://localhost:8787/api/health', {
      headers: { Cookie: `PlainNoteSession=${token}; PlainNoteClientSession=${clientKey}` },
    }),
    env,
  )
  assert.deepEqual(session, { id: [...DB.sessions.keys()][0] })

  const sessionId = [...DB.sessions.keys()][0]
  const logoutRequest = await requireAppSession(
    new Request(`http://localhost:8787/api/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Cookie: `PlainNoteSession=${token}`, 'X-Session-Key': clientKey },
    }),
    env,
  )
  assert.deepEqual(logoutRequest, session)
})

test('requires an app session for deployed API requests', async () => {
  const response = await requireAppSession(new Request('https://notes.example.com/api/health'), {
    DB: new MemoryDatabase(),
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'session_required' })
})

test('checks same-origin writes', () => {
  assert.equal(requireSameOrigin(new Request('https://notes.example.com/api/health')), null)
  assert.equal(
    requireSameOrigin(
      new Request('https://notes.example.com/api/auth/session', {
        method: 'POST',
        headers: { Origin: 'https://notes.example.com' },
      }),
    ),
    null,
  )

  const response = requireSameOrigin(
    new Request('https://notes.example.com/api/auth/session', {
      method: 'POST',
      headers: { Origin: 'https://other.example.com' },
    }),
  )
  assert.equal(response?.status, 403)
})

test('creates opaque cookie sessions for identities allowed by Access', async () => {
  const teamDomain = 'https://test-team.cloudflareaccess.com'
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const publicJwk = await exportJWK(publicKey)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ keys: [{ ...publicJwk, alg: 'RS256', kid: 'test-key', use: 'sig' }] })

  try {
    const DB = new MemoryDatabase()
    const env = {
      DB,
      POLICY_AUD: 'notes-audience',
      TEAM_DOMAIN: teamDomain,
    }
    const createRequest = async (sub) =>
      new Request('https://notes.example.com/api/auth/session', {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': await accessToken(privateKey, teamDomain, sub),
          'Content-Type': 'application/json',
          Origin: 'https://notes.example.com',
        },
        body: JSON.stringify({ name: 'Test browser' }),
      })

    const created = await createAppSession(await createRequest('person-id'), env)
    assert.equal(created.status, 200)
    const setCookie = created.headers.get('Set-Cookie')
    assert.match(setCookie, /PlainNoteSession=[^;]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000; Secure/)
    assert.match(
      setCookie,
      /PlainNoteClientSession=[^;]+; SameSite=Strict; Path=\/; Max-Age=2592000; Secure/,
    )
    const token = setCookie.match(/PlainNoteSession=([^;]+)/)[1]
    const clientKey = setCookie.match(/PlainNoteClientSession=([^;]+)/)[1]
    assert.notEqual([...DB.sessions.values()][0].tokenHash, token)
    assert.notEqual([...DB.sessions.values()][0].clientKeyHash, clientKey)

    const session = await requireAppSession(
      new Request('https://notes.example.com/api/health', {
        headers: { Cookie: `PlainNoteSession=${token}; PlainNoteClientSession=${clientKey}` },
      }),
      env,
    )
    assert.deepEqual(session, { id: [...DB.sessions.keys()][0] })

    const second = await createAppSession(await createRequest('other-person-id'), env)
    assert.equal(second.status, 200)
    assert.equal(DB.sessions.size, 2)

    const status = await sessionApi(
      new Request('https://notes.example.com/api/auth/status'),
      env,
      new URL('https://notes.example.com/api/auth/status'),
      session,
    )
    const value = await status.json()
    assert.equal(value.sessions.length, 2)
    assert.deepEqual(value.sessions[0], {
      id: session.id,
      name: 'Test browser',
      createdAt: DB.sessions.get(session.id).createdAt,
      expiresAt: DB.sessions.get(session.id).expiresAt,
      current: true,
    })

    const logout = await sessionApi(
      new Request(`https://notes.example.com/api/auth/sessions/${session.id}`, {
        method: 'DELETE',
        headers: { Origin: 'https://notes.example.com' },
      }),
      env,
      new URL(`https://notes.example.com/api/auth/sessions/${session.id}`),
      session,
    )
    assert.match(logout.headers.get('Set-Cookie'), /PlainNoteSession=; HttpOnly;[^,]+Max-Age=0/)
    assert.match(logout.headers.get('Set-Cookie'), /PlainNoteClientSession=;[^,]+Max-Age=0/)

    const expired = await requireAppSession(
      new Request('https://notes.example.com/api/health', {
        headers: { Cookie: `PlainNoteSession=${token}; PlainNoteClientSession=${clientKey}` },
      }),
      env,
    )
    assert.equal(expired.status, 401)
  } finally {
    globalThis.fetch = originalFetch
  }
})

function accessToken(privateKey, teamDomain, sub) {
  return new SignJWT({ email: 'person@example.com', sub })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(teamDomain)
    .setAudience('notes-audience')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

class MemoryDatabase {
  sessions = new Map()

  prepare(query) {
    return new MemoryStatement(this, query)
  }

  async batch(statements) {
    for (const statement of statements) await statement.run()
  }
}

class MemoryStatement {
  values = []

  constructor(database, query) {
    this.database = database
    this.query = query.replace(/\s+/g, ' ').trim()
  }

  bind(...values) {
    this.values = values
    return this
  }

  async run() {
    if (this.query.startsWith('INSERT INTO auth_sessions')) {
      const [id, tokenHash, clientKeyHash, name, createdAt, expiresAt] = this.values
      this.database.sessions.set(id, {
        id,
        tokenHash,
        clientKeyHash,
        name,
        createdAt,
        expiresAt,
        revokedAt: null,
      })
    } else if (this.query.startsWith('UPDATE auth_sessions SET revoked_at')) {
      const [revokedAt, id] = this.values
      const session = this.database.sessions.get(id)
      if (session) session.revokedAt = revokedAt
    }
  }

  async first() {
    if (this.query.startsWith('SELECT auth_sessions.id')) {
      const [tokenHash, clientKeyHash, now] = this.values
      const session = [...this.database.sessions.values()].find(
        (candidate) =>
          candidate.tokenHash === tokenHash &&
          candidate.clientKeyHash === clientKeyHash &&
          candidate.revokedAt === null &&
          candidate.expiresAt > now,
      )
      if (!session) return null
      return { id: session.id }
    }
    return null
  }

  async all() {
    if (this.query === 'PRAGMA table_info(auth_sessions)') return { results: [] }
    if (this.query.startsWith('SELECT id, name, created_at AS createdAt')) {
      const [now] = this.values
      return {
        results: [...this.database.sessions.values()]
          .filter((session) => session.revokedAt === null && session.expiresAt > now)
          .map(({ id, name, createdAt, expiresAt }) => ({ id, name, createdAt, expiresAt })),
      }
    }
    return { results: [] }
  }
}
