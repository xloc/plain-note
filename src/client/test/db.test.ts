import { afterEach, expect, test, vi } from 'vite-plus/test'
import type { LocalNote } from '../src/db'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test('does not finish saving a note before its transaction commits', async () => {
  const writeRequest = {} as IDBRequest
  const transaction = {
    objectStore: () => ({ put: () => writeRequest }),
  } as unknown as IDBTransaction
  const openRequest = {
    result: { transaction: () => transaction },
  } as unknown as IDBOpenDBRequest
  vi.stubGlobal('indexedDB', {
    open: () => {
      queueMicrotask(() => openRequest.onsuccess?.(new Event('success')))
      return openRequest
    },
  })
  const db = await import('../src/db')
  const note: LocalNote = {
    id: 'note-id',
    content: '',
    tags: [],
    resources: [],
    createdAt: 1,
    updatedAt: 1,
    revision: 'revision',
    base: null,
    deleted: false,
    syncState: 'pending',
  }

  const saving = db.saveNote(note)
  await vi.waitFor(() => expect(writeRequest.onsuccess).toBeTypeOf('function'))
  writeRequest.onsuccess?.(new Event('success'))
  let saved = false
  void saving.then(() => (saved = true))
  await Promise.resolve()

  expect(saved).toBe(false)
  transaction.oncomplete?.(new Event('complete'))
  await saving
})
