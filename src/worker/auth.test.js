import assert from 'node:assert/strict'
import test from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { requireAccess } from './auth.ts'

test('allows local development without Access configuration', async () => {
  assert.equal(await requireAccess(new Request('http://localhost:8787/api/health'), {}), null)
  assert.equal(await requireAccess(new Request('http://127.0.0.1:8787/api/health'), {}), null)
})

test('fails closed when deployed without Access configuration', async () => {
  const response = await requireAccess(new Request('https://notes.example.com/api/health'), {})

  assert.equal(response?.status, 500)
  assert.deepEqual(await response?.json(), { error: 'auth_not_configured' })
})

test('rejects a deployed request without an Access token', async () => {
  const response = await requireAccess(new Request('https://notes.example.com/api/health'), {
    POLICY_AUD: 'notes-audience',
    TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
  })

  assert.equal(response?.status, 401)
  assert.deepEqual(await response?.json(), { error: 'unauthorized' })
})

test('accepts a valid Cloudflare Access token', async () => {
  const teamDomain = 'https://test-team.cloudflareaccess.com'
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const publicJwk = await exportJWK(publicKey)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ keys: [{ ...publicJwk, alg: 'RS256', kid: 'test-key', use: 'sig' }] })

  try {
    const token = await new SignJWT({ email: 'person@example.com' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(teamDomain)
      .setAudience('notes-audience')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
    const request = new Request('https://notes.example.com/api/health', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    })

    assert.equal(await requireAccess(request, {
      POLICY_AUD: 'notes-audience',
      TEAM_DOMAIN: teamDomain,
    }), null)
  }
  finally {
    globalThis.fetch = originalFetch
  }
})
