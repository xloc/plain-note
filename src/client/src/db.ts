import type { NoteRecord, NoteResource } from '../../shared/note'

export type LocalNote = {
  id: string
  content: string
  tags: string[]
  resources: NoteResource[]
  createdAt: number
  updatedAt: number
  revision: string
  baseRevision: string | null
  deleted: boolean
  syncState: 'pending' | 'synced' | 'conflict'
  conflict?: NoteRecord
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

export async function clearLocalData() {
  const transaction = (await database).transaction(['notes', 'meta'], 'readwrite')
  transaction.objectStore('notes').clear()
  transaction.objectStore('meta').clear()
  await complete(transaction)
}

export async function getMeta(key: string) {
  const row = await request<{ key: string, value: string | number } | undefined>(
    (await database).transaction('meta').objectStore('meta').get(key),
  )
  return row?.value
}

export async function setMeta(key: string, value: string | number) {
  await request((await database).transaction('meta', 'readwrite').objectStore('meta').put({ key, value }))
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const result = indexedDB.open('plain-note', 1)
    result.onupgradeneeded = () => {
      result.result.createObjectStore('notes', { keyPath: 'id' })
      result.result.createObjectStore('meta', { keyPath: 'key' })
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
