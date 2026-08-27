import { createRemoteJWKSet, jwtVerify } from 'jose'

export type AuthEnv = {
  POLICY_AUD?: string
  TEAM_DOMAIN?: string
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export async function requireAccess(request: Request, env: AuthEnv) {
  if (isLocal(request))
    return null

  if (!env.POLICY_AUD || !env.TEAM_DOMAIN)
    return error('auth_not_configured', 500)

  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token)
    return error('unauthorized', 401)

  try {
    let keySet = keySets.get(env.TEAM_DOMAIN)
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', env.TEAM_DOMAIN))
      keySets.set(env.TEAM_DOMAIN, keySet)
    }
    await jwtVerify(token, keySet, {
      algorithms: ['RS256'],
      audience: env.POLICY_AUD,
      issuer: env.TEAM_DOMAIN,
    })
    return null
  }
  catch {
    return error('unauthorized', 401)
  }
}

function isLocal(request: Request) {
  const hostname = new URL(request.url).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function error(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
