import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { approveCli, exchangeCli } from './cli-auth.ts'
import { createAppSession, requireAppSession, sessionApi } from './auth.ts'

class Database {
  sqlite = new DatabaseSync(':memory:')
  prepare(source) {
    const statement = this.sqlite.prepare(source)
    let values = []
    return {
      bind(...parameters) {
        values = parameters
        return this
      },
      async first() {
        return statement.get(...values) ?? null
      },
      async all() {
        return { results: statement.all(...values) }
      },
      async run() {
        return statement.run(...values)
      },
    }
  }
}

function request(path, body) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function authorization() {
  const verifier = randomBytes(32).toString('base64url')
  return {
    verifier,
    grant: {
      id: randomUUID(),
      challenge: createHash('sha256').update(verifier).digest('base64url'),
      name: 'CLI · test',
    },
  }
}

async function browser(db) {
  const response = await createAppSession(request('/api/auth/session', { name: 'Browser' }), { DB: db })
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
  const session = await requireAppSession(
    new Request('http://localhost/api/auth/status', { headers: { Cookie: cookies } }),
    { DB: db },
  )
  return session
}

test('browser approval grants one separate, revocable CLI session without exposing the verifier', async () => {
  const db = new Database()
  try {
    const { verifier, grant } = authorization()
    const exchange = (secret = verifier) =>
      exchangeCli(request('/api/auth/cli/exchange', { id: grant.id, verifier: secret }), db)
    assert.equal((await exchange()).status, 202)
    const session = await browser(db)
    assert.equal((await approveCli(request('/api/auth/cli/approve', grant), db, session.id)).status, 200)
    assert.equal((await exchange(randomBytes(32).toString('base64url'))).status, 202)
    const result = await exchange()
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('Cache-Control'), 'no-store')
    const credentials = await result.json()
    const cliRequest = new Request('http://localhost/api/auth/status', {
      headers: { Cookie: `PlainNoteSession=${credentials.token}; PlainNoteClientSession=${credentials.clientKey}` },
    })
    const cli = await requireAppSession(cliRequest, { DB: db })
    assert.notEqual(cli.id, session.id)
    const status = await (await sessionApi(cliRequest, { DB: db }, new URL(cliRequest.url), cli)).json()
    assert.equal(status.sessions.length, 2)
    assert.equal(status.sessions.find((entry) => entry.current).name, grant.name)
    assert.equal((await exchange()).status, 202)
    assert.equal((await approveCli(request('/api/auth/cli/approve', grant), db, session.id)).status, 409)
    const revoke = new Request(`http://localhost/api/auth/sessions/${cli.id}`, { method: 'DELETE' })
    await sessionApi(revoke, { DB: db }, new URL(revoke.url), session)
    assert.equal((await requireAppSession(cliRequest, { DB: db })).status, 401)
    const stored = db.sqlite.prepare('SELECT * FROM cli_grants').get()
    assert.equal(stored.challenge, grant.challenge)
    assert.equal(JSON.stringify(stored).includes(verifier), false)
  } finally {
    db.sqlite.close()
  }
})

test('expired grants and grants from revoked browser sessions cannot issue credentials', async () => {
  const db = new Database()
  try {
    const session = await browser(db)
    for (const reason of ['expired', 'revoked']) {
      const { verifier, grant } = authorization()
      await approveCli(request('/api/auth/cli/approve', grant), db, session.id)
      if (reason === 'expired') db.sqlite.prepare('UPDATE cli_grants SET expires_at = 0 WHERE id = ?').run(grant.id)
      else db.sqlite.prepare('UPDATE auth_sessions SET revoked_at = 1 WHERE id = ?').run(session.id)
      const response = await exchangeCli(request('/api/auth/cli/exchange', { id: grant.id, verifier }), db)
      assert.equal(response.status, 202)
    }
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count, 1)
  } finally {
    db.sqlite.close()
  }
})

test('rejects malformed CLI authorizations', async () => {
  const db = new Database()
  try {
    assert.equal((await approveCli(request('/api/auth/cli/approve', { id: '../note' }), db, 'session')).status, 400)
    assert.equal((await exchangeCli(request('/api/auth/cli/exchange', { verifier: 'wrong' }), db)).status, 400)
  } finally {
    db.sqlite.close()
  }
})
