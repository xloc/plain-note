import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import type { AuthStatus } from '../../shared/auth'
import { useAuthStore } from '../src/stores/auth'

const deviceHints = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@varienos/device-detector-js', () => ({
  default: class {
    awaitHighEntropyValues = deviceHints
    getDeviceInfo() {
      return { browser: { name: 'Test' }, isAndroid: false, isIOS: false, os: { name: 'Linux' } }
    }
    getHighEntropyValues() {
      return undefined
    }
  },
}))

const authStatus: AuthStatus = {
  currentSessionId: 'session-id',
  sessions: [
    {
      id: 'session-id',
      name: 'Test browser',
      createdAt: 1,
      expiresAt: 2,
      current: true,
    },
  ],
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('document', { cookie: '' })
  vi.stubGlobal('location', { protocol: 'https:' })
  vi.stubGlobal('sessionStorage', memoryStorage())
  deviceHints.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('asks the server for the session even when the readable cookie is unavailable', async () => {
  const fetch = vi.fn(async () => Response.json(authStatus))
  vi.stubGlobal('fetch', fetch)

  const auth = useAuthStore()
  await auth.initialize()

  expect(fetch).toHaveBeenCalledWith('/api/auth/status', undefined)
  expect(auth.state).toBe('ready')
  expect(auth.status).toEqual(authStatus)
})

test('reports an unexpected server rejection without clearing the app session', async () => {
  const document = { cookie: 'PlainNoteClientSession=still-valid' }
  vi.stubGlobal('document', document)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Unauthorized', { status: 401 })),
  )

  const auth = useAuthStore()
  await auth.initialize()

  expect(auth.state).toBe('unknown')
  expect(auth.message).toBe('Request failed with 401')
  expect(document.cookie).toBe('PlainNoteClientSession=still-valid')
})

test.each(['signedOut', 'unknown'] as const)(
  'starts sign-in from %s with a browser navigation before creating a session',
  async (state) => {
    const assign = vi.fn()
    vi.stubGlobal('location', {
      protocol: 'https:',
      origin: 'https://notes.example.com',
      pathname: '/notes/one',
      search: '?sessions=1',
      hash: '#section',
      assign,
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const auth = useAuthStore()
    if (state === 'signedOut') auth.signOutBestEffort()
    await auth.signIn()

    expect(assign).toHaveBeenCalledWith(
      new URL('https://notes.example.com/api/auth/login?redirect=%2Fnotes%2Fone%3Fsessions%3D1%23section'),
    )
    expect(sessionStorage.getItem('plain-note:sign-in')).toBe('1')
    expect(fetch).not.toHaveBeenCalled()
  },
)

test('leaves the session unknown when an offline startup cannot validate it, and allows retry', async () => {
  vi.stubGlobal('navigator', { onLine: false })
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  await auth.initialize()
  expect(auth.state).toBe('unknown')
  expect(auth.checking).toBe(false)
  expect(auth.message).toBe('Failed to fetch')

  fetch.mockResolvedValueOnce(Response.json(authStatus))
  await auth.initialize()
  expect(auth.state).toBe('ready')
  expect(auth.message).toBe('')
})

test('clears the client session only when the Worker reports that it expired', async () => {
  const document = { cookie: 'PlainNoteClientSession=expired' }
  vi.stubGlobal('document', document)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'session_required' }, { status: 401 })),
  )

  const auth = useAuthStore()
  await auth.initialize()

  expect(auth.state).toBe('signedOut')
  expect(document.cookie).toContain('PlainNoteClientSession=;')
  expect(document.cookie).toContain('Max-Age=0')
})

test('creates an app session after returning from the Cloudflare login flow', async () => {
  const storage = memoryStorage()
  storage.setItem('plain-note:sign-in', '1')
  vi.stubGlobal('sessionStorage', storage)
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'session_required' }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json(authStatus))
  vi.stubGlobal('fetch', fetch)

  const auth = useAuthStore()
  await auth.initialize()

  expect(auth.state).toBe('ready')
  expect(fetch.mock.calls[1]?.[0]).toBe('/api/auth/session')
  expect(fetch.mock.calls[1]?.[1]).toEqual({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Linux PC · Test' }),
  })
  expect(storage.getItem('plain-note:sign-in')).toBeNull()
})

test('reuses a valid app session after returning from sign-in', async () => {
  sessionStorage.setItem('plain-note:sign-in', '1')
  const fetch = vi.fn(async () => Response.json(authStatus))
  vi.stubGlobal('fetch', fetch)

  const auth = useAuthStore()
  await auth.initialize()

  expect(auth.state).toBe('ready')
  expect(auth.status?.currentSessionId).toBe(authStatus.currentSessionId)
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/auth/status', undefined)
  expect(sessionStorage.getItem('plain-note:sign-in')).toBeNull()
})

test.each([false, true])(
  'does not restore a stale response after signing out (returning from sign-in: %s)',
  async (returningFromSignIn) => {
    let respond!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>((resolve) => (respond = resolve)))
    if (returningFromSignIn) {
      sessionStorage.setItem('plain-note:sign-in', '1')
      fetch
        .mockResolvedValueOnce(Response.json({ error: 'session_required' }, { status: 401 }))
        .mockResolvedValueOnce(Response.json({ ok: true }))
    }
    vi.stubGlobal('fetch', fetch)

    const auth = useAuthStore()
    const checking = auth.initialize()
    await vi.waitFor(() => expect(respond).toBeTypeOf('function'))
    auth.signOutBestEffort()
    respond(Response.json(authStatus))
    await checking

    expect(auth.state).toBe('signedOut')
    expect(auth.status).toBeNull()
    expect(sessionStorage.getItem('plain-note:sign-in')).toBeNull()
  },
)

test('revalidates a ready session without interrupting synchronization', async () => {
  let resolveRefresh!: (response: Response) => void
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(authStatus))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveRefresh = resolve)))
  vi.stubGlobal('fetch', fetch)

  const auth = useAuthStore()
  await auth.initialize()
  const refreshing = auth.initialize()

  expect(auth.state).toBe('ready')
  resolveRefresh(Response.json(authStatus))
  await refreshing
  expect(auth.state).toBe('ready')
})

test('keeps a known session valid when a refresh temporarily fails', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(authStatus))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  await auth.initialize()
  await auth.initialize()

  expect(auth.state).toBe('ready')
  expect(auth.status).toEqual(authStatus)
  expect(auth.checking).toBe(false)
  expect(auth.message).toBe('Failed to fetch')
})

test.each(['one', 'all'])('invalidates the session when revoking %s returns session_required', async (which) => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(authStatus))
    .mockResolvedValueOnce(Response.json({ error: 'session_required' }, { status: 401 }))
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  await auth.initialize()

  await expect(which === 'all' ? auth.revokeAll() : auth.revokeSession('other-session')).rejects.toThrow(
    'session_required',
  )
  expect(auth.state).toBe('signedOut')
  expect(auth.status).toBeNull()
})

test('signing out during device detection prevents session creation', async () => {
  const hints = deferred<void>()
  deviceHints.mockReturnValueOnce(hints.promise)
  sessionStorage.setItem('plain-note:sign-in', '1')
  const fetch = vi.fn().mockImplementation(async () => Response.json({ error: 'session_required' }, { status: 401 }))
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  const checking = auth.initialize()
  await vi.waitFor(() => expect(deviceHints).toHaveBeenCalledOnce())

  auth.signOutBestEffort()
  hints.resolve()
  await checking
  await auth.initialize()

  expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/auth/status', '/api/auth/status'])
  expect(auth.state).toBe('signedOut')
  expect(sessionStorage.getItem('plain-note:sign-in')).toBeNull()
})

test('signing out before the initial check finishes cancels saved sign-in intent', async () => {
  const response = deferred<Response>()
  sessionStorage.setItem('plain-note:sign-in', '1')
  const fetch = vi.fn().mockReturnValueOnce(response.promise)
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  const checking = auth.initialize()

  auth.signOutBestEffort()
  expect(auth.checking).toBe(false)
  response.resolve(Response.json({ error: 'session_required' }, { status: 401 }))
  await checking

  expect(sessionStorage.getItem('plain-note:sign-in')).toBeNull()
  expect(fetch).toHaveBeenCalledOnce()
  expect(auth.state).toBe('signedOut')
})

test('protected requests wait for initial sign-in instead of invalidating it', async () => {
  const hints = deferred<void>()
  deviceHints.mockReturnValueOnce(hints.promise)
  sessionStorage.setItem('plain-note:sign-in', '1')
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'session_required' }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json(authStatus))
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  const operation = vi.fn(async () => 'result')
  const requested = auth.withSession(operation)
  await vi.waitFor(() => expect(deviceHints).toHaveBeenCalledOnce())
  expect(operation).not.toHaveBeenCalled()

  hints.resolve()
  await expect(requested).resolves.toBe('result')
  expect(auth.state).toBe('ready')
  expect(operation).toHaveBeenCalledOnce()
})

test('protected requests keep running during a background check of a known session', async () => {
  const refresh = deferred<Response>()
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(authStatus)).mockReturnValueOnce(refresh.promise)
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  await auth.initialize()
  const checking = auth.initialize()

  await expect(auth.withSession(async () => 'result')).resolves.toBe('result')
  expect(auth.checking).toBe(true)
  refresh.resolve(new Response('Unavailable', { status: 503 }))
  await checking
  expect(auth.state).toBe('ready')
})

test('signing out while a protected request waits prevents it from starting', async () => {
  const response = deferred<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise),
  )
  const auth = useAuthStore()
  const operation = vi.fn(async () => 'result')
  const rejected = expect(auth.withSession(operation)).rejects.toThrow('Sign in')

  auth.signOutBestEffort()
  response.resolve(Response.json(authStatus))
  await rejected

  expect(operation).not.toHaveBeenCalled()
  expect(auth.state).toBe('signedOut')
})

test.each([true, false])('clears late creation cookies after sign-out (successful response: %s)', async (ok) => {
  const creation = deferred<Response>()
  sessionStorage.setItem('plain-note:sign-in', '1')
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'session_required' }, { status: 401 }))
    .mockReturnValueOnce(creation.promise)
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  const checking = auth.initialize()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

  auth.signOutBestEffort()
  // Browsers apply Set-Cookie before application code receives the response.
  document.cookie = 'PlainNoteClientSession=late-session'
  creation.resolve(ok ? Response.json({ ok: true }) : new Response('Invalid response', { status: 502 }))
  await checking

  expect(document.cookie).toContain('PlainNoteClientSession=;')
  expect(auth.state).toBe('signedOut')
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('finishes best-effort revocation before starting a new sign-in', async () => {
  const revocation = deferred<Response>()
  const assign = vi.fn()
  vi.stubGlobal('location', {
    protocol: 'https:',
    origin: 'https://notes.example.com',
    pathname: '/',
    search: '',
    hash: '',
    assign,
  })
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(authStatus)).mockReturnValueOnce(revocation.promise)
  vi.stubGlobal('fetch', fetch)
  document.cookie = 'PlainNoteClientSession=current-secret'
  const auth = useAuthStore()
  await auth.initialize()
  auth.signOutBestEffort()
  const signingIn = auth.signIn()
  await Promise.resolve()

  expect(auth.state).toBe('signedOut')
  expect(assign).not.toHaveBeenCalled()
  expect(fetch.mock.calls[1]?.[1]).toEqual({ method: 'DELETE', headers: { 'X-Session-Key': 'current-secret' } })
  revocation.resolve(Response.json({ ok: true }))
  await signingIn
  expect(assign).toHaveBeenCalledOnce()
})

test('coalesces simultaneous session checks', async () => {
  const response = deferred<Response>()
  const fetch = vi.fn(() => response.promise)
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  const first = auth.initialize()
  const second = auth.initialize()
  expect(auth.checking).toBe(true)
  response.resolve(Response.json(authStatus))
  await Promise.all([first, second])
  expect(fetch).toHaveBeenCalledOnce()
  expect(auth.checking).toBe(false)
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => (resolve = resolvePromise))
  return { promise, resolve }
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  }
}
