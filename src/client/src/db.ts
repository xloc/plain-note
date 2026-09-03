import type { NoteRecord, NoteResource } from '../../shared/note'

export type LocalResource = NoteResource & {
  noteId: string
  blob: Blob
  syncState: 'pending' | 'synced'
}

export type LocalNote = {
  id: string
  content: string
  tags: string[]
  resources: NoteResource[]
  createdAt: number
  updatedAt: number
  revision: string
  base: NoteRecord | null
  deleted: boolean
  syncState: 'pending' | 'synced'
}

const database = openDatabase()

export async function loadNotes() {
  return request<LocalNote[]>((await database).transaction('notes').objectStore('notes').getAll())
}

export async function saveNote(note: LocalNote) {
  await request((await database).transaction('notes', 'readwrite').objectStore('notes').put(note))
}

export async function removeNote(id: string) {
  await request((await database).transaction('notes', 'readwrite').objectStore('notes').delete(id))
}

export async function getResource(noteId: string, id: string) {
  return request<LocalResource | undefined>(
    (await database).transaction('resources').objectStore('resources').get([noteId, id]),
  )
}

export async function loadResources(noteId: string) {
  return request<LocalResource[]>(
    (await database).transaction('resources').objectStore('resources').index('noteId').getAll(noteId),
  )
}

export async function saveResource(resource: LocalResource) {
  await request((await database).transaction('resources', 'readwrite').objectStore('resources').put(resource))
}

export async function removeResource(noteId: string, id: string) {
  await request((await database).transaction('resources', 'readwrite').objectStore('resources').delete([noteId, id]))
}

export async function removeNoteResources(noteId: string) {
  const transaction = (await database).transaction('resources', 'readwrite')
  const store = transaction.objectStore('resources')
  const keys = await request<IDBValidKey[]>(store.index('noteId').getAllKeys(noteId))
  for (const key of keys) store.delete(key)
  await complete(transaction)
}

export async function clearLocalData() {
  const transaction = (await database).transaction(['notes', 'resources', 'meta'], 'readwrite')
  transaction.objectStore('notes').clear()
  transaction.objectStore('resources').clear()
  transaction.objectStore('meta').clear()
  await complete(transaction)
}

export async function getMeta(key: string) {
  const row = await request<{ key: string; value: string | number } | undefined>(
    (await database).transaction('meta').objectStore('meta').get(key),
  )
  return row?.value
}

export async function setMeta(key: string, value: string | number) {
  await request((await database).transaction('meta', 'readwrite').objectStore('meta').put({ key, value }))
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const result = indexedDB.open('plain-note', 5)
    result.onupgradeneeded = () => {
      if (!result.result.objectStoreNames.contains('notes')) result.result.createObjectStore('notes', { keyPath: 'id' })
      if (!result.result.objectStoreNames.contains('meta')) result.result.createObjectStore('meta', { keyPath: 'key' })
      if (!result.result.objectStoreNames.contains('resources')) {
        result.result.createObjectStore('resources', { keyPath: ['noteId', 'id'] }).createIndex('noteId', 'noteId')
      }
    }
    result.onsuccess = () => resolve(result.result)
    result.onerror = () => reject(result.error)
  })
}

function request<T = IDBValidKey>(result: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    result.onsuccess = () => resolve(result.result)
    result.onerror = () => reject(result.error)
  })
}

function complete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
