import { expect, test } from 'vite-plus/test'
import type { Note } from '../../shared/note.ts'
import * as encryption from '../src/encryption.ts'

test('creates a portable random vault key', async () => {
  const secret = encryption.recoveryKey.create()
  const imported = await encryption.recoveryKey.import(secret)

  expect(secret).toMatch(/^pn1-(?:[1-9A-HJ-NP-Za-km-z]{5}-)*[1-9A-HJ-NP-Za-km-z]{1,5}$/)
  expect(imported.secret).toBe(secret)
  expect(imported.id).toHaveLength(43)
  expect((await encryption.recoveryKey.import(secret)).id).toBe(imported.id)
  expect((await encryption.recoveryKey.import(secret, true)).id).toBe(imported.id)
})

test('rejects obsolete recovery key formats', async () => {
  await expect(
    encryption.recoveryKey.import('plain-note-v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
  ).rejects.toThrow('Encryption key must start with pn1-')
})

test('shares ciphertext between native and software AES-GCM', async () => {
  const secret = encryption.recoveryKey.create()
  const native = (await encryption.recoveryKey.import(secret)).key
  const software = (await encryption.recoveryKey.import(secret, true)).key
  const note: Note = {
    id: 'note-id',
    content: 'portable ciphertext',
    tags: [],
    resources: [],
    createdAt: 1,
    updatedAt: 2,
    revision: 'revision-id',
  }

  expect(await encryption.note.decrypt(await encryption.note.encrypt(note, native), software)).toEqual(note)
  expect(await encryption.note.decrypt(await encryption.note.encrypt(note, software), native)).toEqual(note)
})

test('encrypts note contents while projecting authenticated resource IDs', async () => {
  const key = (await encryption.recoveryKey.import(encryption.recoveryKey.create())).key
  const note: Note = {
    id: 'note-id',
    content: 'private words',
    tags: ['private-tag'],
    resources: [{ id: 'resource-id', name: 'private.pdf', mime: 'application/pdf', size: 12, createdAt: 1 }],
    createdAt: 1,
    updatedAt: 2,
    revision: 'revision-id',
  }

  const encrypted = await encryption.note.encrypt(note, key)

  expect(encrypted.resourceIds).toEqual(['resource-id'])
  expect(JSON.stringify(encrypted)).not.toContain('private words')
  expect(JSON.stringify(encrypted)).not.toContain('private.pdf')
  expect(await encryption.note.decrypt(encrypted, key)).toEqual(note)
  await expect(encryption.note.decrypt({ ...encrypted, resourceIds: [] }, key)).rejects.toThrow()
})

test('encrypts resource bytes and binds them to their note and resource IDs', async () => {
  const key = (await encryption.recoveryKey.import(encryption.recoveryKey.create())).key
  const source = new Blob(['private resource'], { type: 'text/plain' })
  const encrypted = await encryption.resource.encrypt(source, 'note-id', 'resource-id', key)

  expect(await encrypted.text()).not.toContain('private resource')
  const decrypted = await encryption.resource.decrypt(encrypted, 'note-id', 'resource-id', 'text/plain', key)
  expect(decrypted.type).toBe('text/plain')
  expect(await decrypted.text()).toBe('private resource')
  await expect(encryption.resource.decrypt(encrypted, 'note-id', 'other-id', 'text/plain', key)).rejects.toThrow()
})
