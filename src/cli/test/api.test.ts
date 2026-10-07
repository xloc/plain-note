import { afterEach, expect, test, vi } from 'vite-plus/test'
import * as encryption from '@plain-note/shared/encryption'
import type { Note, NoteResource } from '@plain-note/shared/note'
import { createApi } from '../src/api.ts'

afterEach(() => vi.unstubAllGlobals())

test('sends app credentials and encrypted note content at the cloud boundary', async () => {
  const vault = await encryption.recoveryKey.import(encryption.recoveryKey.create())
  const note: Note = {
    id: 'note',
    content: 'Private Markdown\r\n',
    revision: 'revision',
    createdAt: 1,
    updatedAt: 2,
    tags: [],
    resources: [],
  }
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    expect(url.href).toBe('https://notes.example.com/api/notes/note')
    expect(init.redirect).toBe('error')
    const headers = new Headers(init.headers)
    expect(headers.get('Cookie')).toBe('PlainNoteSession=token; PlainNoteClientSession=client')
    expect(headers.get('Origin')).toBe('https://notes.example.com')
    expect(headers.get('X-Vault-Key-Id')).toBe(vault.id)
    const body = JSON.parse(String(init.body))
    expect(body.baseRevision).toBe(null)
    expect(body.note.content).toBeUndefined()
    expect(await encryption.note.decrypt(body.note, vault.key)).toEqual(note)
    return Response.json({ note: body.note })
  })
  const api = await createApi({
    server: 'https://notes.example.com',
    recoveryKey: vault.secret,
    token: 'token',
    clientKey: 'client',
  })
  expect(await api.put(note, null)).toEqual(note)
})

test('encrypts restored original attachments and decrypts resource downloads', async () => {
  const vault = await encryption.recoveryKey.import(encryption.recoveryKey.create())
  const resource: NoteResource = { id: 'resource', name: 'file.txt', mime: 'text/plain', size: 5, createdAt: 1 }
  let ciphertext: Blob
  vi.stubGlobal('fetch', async (_url: URL, init: RequestInit) => {
    if (init.method === 'PUT') {
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/octet-stream')
      ciphertext = init.body as Blob
      expect(await ciphertext.text()).not.toBe('bytes')
      expect(
        await (await encryption.resource.decrypt(ciphertext, 'note', resource.id, resource.mime, vault.key)).text(),
      ).toBe('bytes')
      return Response.json({ ok: true })
    }
    return new Response(ciphertext)
  })
  const api = await createApi({
    server: 'https://notes.example.com',
    recoveryKey: vault.secret,
    token: 'token',
    clientKey: 'client',
  })
  await api.restoreResource('note', resource, new TextEncoder().encode('bytes'))
  expect(new TextDecoder().decode(await api.resource('note', resource))).toBe('bytes')
})

test('an expired CLI session asks for authentication again', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: 'session_required' }, { status: 401 }))
  const api = await createApi({
    server: 'https://notes.example.com',
    recoveryKey: encryption.recoveryKey.create(),
    token: 'token',
    clientKey: 'client',
  })
  await expect(api.changes(null, 0)).rejects.toThrow('Run plain-note auth')
})
