import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import * as api from '../src/api'
import { useAuthStore } from '../src/stores/auth'

vi.mock('../src/stores/vault', () => ({ currentVault: () => ({ id: 'vault', key: 'key' }) }))
vi.mock('../src/encryption', () => ({
  resource: { encrypt: async (blob: Blob) => blob, decrypt: async (blob: Blob) => blob },
  record: { decrypt: async () => ({ id: 'note', deleted: true, revision: 'remote', updatedAt: 2 }) },
}))

const resource = { id: 'resource', name: 'file.txt', mime: 'text/plain', size: 4, createdAt: 1 }
let upload: TestUpload | undefined

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('document', { cookie: 'PlainNoteClientSession=valid' })
  vi.stubGlobal('location', { protocol: 'https:' })
  vi.stubGlobal('sessionStorage', { removeItem: vi.fn() })
  vi.stubGlobal('XMLHttpRequest', TestUpload)
  upload = undefined
})

afterEach(() => vi.unstubAllGlobals())

test.each(['sync', 'storage', 'download', 'upload', 'listener'])(
  'invalidates the session when %s receives the Worker session_required response',
  async (operation) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ currentSessionId: 'session', sessions: [] }))
      .mockImplementation(async () => Response.json({ error: 'session_required' }, { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    const auth = useAuthStore()
    await auth.initialize()

    const operations: Record<string, () => Promise<unknown>> = {
      sync: () => api.getChanges(null, 0),
      storage: () => api.getStorageStatus(),
      download: () => api.getResource('note', resource),
      upload: () => api.putResource('note', resource, new Blob(['file']), vi.fn()),
      listener: () => api.waitForChanges(null, 0, null, new AbortController().signal),
    }
    const rejected = expect(operations[operation]!()).rejects.toThrow('session_required')
    if (operation === 'upload') {
      await vi.waitFor(() => expect(upload).toBeDefined())
      upload!.respond(401, JSON.stringify({ error: 'session_required' }))
    }
    await rejected

    expect(auth.state).toBe('signedOut')
    expect(auth.status).toBeNull()
    expect(document.cookie).toContain('Max-Age=0')
  },
)

test.each([
  { status: 401, body: 'Access login page' },
  { status: 401, body: JSON.stringify({ error: 'unauthorized' }) },
  { status: 503, body: JSON.stringify({ error: 'session_required' }) },
])('preserves the app session on an unrelated rejection: $status $body', async ({ status, body }) => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ currentSessionId: 'session', sessions: [] }))
    .mockImplementation(async () => new Response(body, { status }))
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  await auth.initialize()

  await expect(api.getStorageStatus()).rejects.toThrow()
  const rejected = expect(api.putResource('note', resource, new Blob(['file']), vi.fn())).rejects.toThrow()
  await vi.waitFor(() => expect(upload).toBeDefined())
  upload!.respond(status, body)
  await rejected

  expect(auth.state).toBe('ready')
  expect(document.cookie).toBe('PlainNoteClientSession=valid')
})

test('ignores an old request failure after the session lifecycle has changed', async () => {
  let respond!: (response: Response) => void
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ currentSessionId: 'old-session', sessions: [] }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => (respond = resolve)))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ currentSessionId: 'new-session', sessions: [] }))
  vi.stubGlobal('fetch', fetch)
  const auth = useAuthStore()
  await auth.initialize()
  const rejected = expect(api.getStorageStatus()).rejects.toThrow('session_required')
  auth.signOutBestEffort()
  await auth.initialize()
  respond(Response.json({ error: 'session_required' }, { status: 401 }))
  await rejected

  expect(auth.state).toBe('ready')
  expect(auth.status?.currentSessionId).toBe('new-session')
})

test('keeps note-specific error handling in the note API', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ currentSessionId: 'session', sessions: [] }))
    .mockResolvedValueOnce(Response.json({ error: 'not_found' }, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ error: 'auto_sync_paused', retryAt: 123 }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ error: 'vault_key_mismatch' }, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ error: 'conflict', current: { encrypted: 'remote' } }, { status: 409 }))
  vi.stubGlobal('fetch', fetch)

  await expect(api.getNote('note')).rejects.toBeInstanceOf(api.ApiNotFound)
  await expect(api.getChanges(null, 0)).rejects.toMatchObject({ retryAt: 123 })
  await expect(api.getStorageStatus()).rejects.toThrow('different encryption key')
  await expect(api.getNote('note')).rejects.toMatchObject({
    current: { id: 'note', deleted: true, revision: 'remote', updatedAt: 2 },
  })
})

test('preserves vault headers, upload progress, and binary downloads', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ currentSessionId: 'session', sessions: [] }))
    .mockImplementation(async () => new Response(new Blob(['file'])))
  vi.stubGlobal('fetch', fetch)
  const downloaded = await api.getResource('note', resource)
  expect(await downloaded.text()).toBe('file')
  expect(fetch).toHaveBeenCalledWith('/api/notes/note/resources/resource', { headers: { 'X-Vault-Key-Id': 'vault' } })

  const progress = vi.fn()
  const uploading = api.putResource('note', resource, new Blob(['file']), progress)
  await vi.waitFor(() => expect(upload).toBeDefined())
  expect(upload!.open).toHaveBeenCalledWith('PUT', '/api/notes/note/resources/resource')
  expect(upload!.setRequestHeader).toHaveBeenCalledWith('X-Vault-Key-Id', 'vault')
  upload!.upload.onprogress!({ total: 4, loaded: 2 })
  upload!.respond(200, JSON.stringify({ ok: true }))
  await uploading
  expect(progress.mock.calls).toEqual([[0.5], [1]])
})

class TestUpload {
  status = 0
  responseText = ''
  upload = { onprogress: null as ((event: { total: number; loaded: number }) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()

  constructor() {
    upload = this
  }

  respond(status: number, text: string) {
    this.status = status
    this.responseText = text
    this.onload!()
  }
}
