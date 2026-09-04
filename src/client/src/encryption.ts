import { gcm } from '@noble/ciphers/aes.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58, base64 } from '../../shared/base'
import type { EncryptedNote, Note, NoteRecord, RemoteNoteRecord } from '../../shared/note'

const VERSION = 1
const NONCE_BYTES = 12
const KEY_PREFIX = 'pn1-'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
type Bytes = Uint8Array<ArrayBuffer>

export type VaultKey = {
  bytes: Bytes
  native?: CryptoKey
}

export class DecryptionError extends Error {
  constructor() {
    super('This device does not have the encryption key for these notes')
  }
}

export const recoveryKey = {
  create() {
    return formatRecoveryKey(crypto.getRandomValues(new Uint8Array(32)))
  },

  async import(value: string, forceSoftware = false) {
    const { secret, bytes } = parseRecoveryKey(value)
    const native = forceSoftware
      ? undefined
      : await crypto.subtle?.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
    const digest = forceSoftware ? sha256(bytes) : ((await crypto.subtle?.digest('SHA-256', bytes)) ?? sha256(bytes))
    return { secret, key: { bytes, native } satisfies VaultKey, id: base64.encode(digest) }
  },
}

export const note = {
  async encrypt(value: Note, key: VaultKey): Promise<EncryptedNote> {
    const resourceIds = value.resources.map((resource) => resource.id)
    const encrypted = await cipher.encrypt(
      encoder.encode(JSON.stringify(value)),
      encryptionContext.forNote(value.id, value.revision, value.updatedAt, resourceIds),
      key,
    )
    return {
      id: value.id,
      revision: value.revision,
      updatedAt: value.updatedAt,
      resourceIds,
      encrypted: base64.encode(encrypted),
    }
  },

  async decrypt(value: EncryptedNote, key: VaultKey): Promise<Note> {
    try {
      const source = await cipher.decrypt(
        base64.decode(value.encrypted),
        encryptionContext.forNote(value.id, value.revision, value.updatedAt, value.resourceIds),
        key,
      )
      const payload = JSON.parse(decoder.decode(source)) as Note
      const resourceIds = payload.resources.map((resource) => resource.id)
      if (
        payload.id !== value.id ||
        payload.revision !== value.revision ||
        payload.updatedAt !== value.updatedAt ||
        resourceIds.length !== value.resourceIds.length ||
        resourceIds.some((id, index) => id !== value.resourceIds[index])
      ) {
        throw new Error('Encrypted resource list does not match its operational projection')
      }
      return payload
    } catch (error) {
      if (error instanceof DecryptionError) throw error
      throw new DecryptionError()
    }
  },
}

export const record = {
  async decrypt(value: RemoteNoteRecord, key: VaultKey): Promise<NoteRecord> {
    return 'deleted' in value ? value : note.decrypt(value, key)
  },
}

export const resource = {
  async encrypt(blob: Blob, noteId: string, resourceId: string, key: VaultKey) {
    const encrypted = await cipher.encrypt(
      new Uint8Array(await blob.arrayBuffer()),
      encryptionContext.forResource(noteId, resourceId),
      key,
    )
    return new Blob([encrypted], { type: 'application/octet-stream' })
  },

  async decrypt(blob: Blob, noteId: string, resourceId: string, mime: string, key: VaultKey) {
    try {
      const decrypted = await cipher.decrypt(
        new Uint8Array(await blob.arrayBuffer()),
        encryptionContext.forResource(noteId, resourceId),
        key,
      )
      return new Blob([decrypted], { type: mime })
    } catch {
      throw new DecryptionError()
    }
  },
}

const cipher = {
  async encrypt(source: Bytes, additionalData: Bytes, key: VaultKey): Promise<Bytes> {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
    const ciphertext = key.native
      ? new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData }, key.native, source))
      : (gcm(key.bytes, nonce, additionalData).encrypt(source) as Bytes)
    const result = new Uint8Array(1 + nonce.length + ciphertext.length)
    result[0] = VERSION
    result.set(nonce, 1)
    result.set(ciphertext, 1 + nonce.length)
    return result
  },

  async decrypt(source: Bytes, additionalData: Bytes, key: VaultKey): Promise<Bytes> {
    if (source[0] !== VERSION || source.length <= 1 + NONCE_BYTES) throw new DecryptionError()
    const nonce = source.slice(1, 1 + NONCE_BYTES)
    const ciphertext = source.slice(1 + NONCE_BYTES)
    return key.native
      ? new Uint8Array(
          await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData }, key.native, ciphertext),
        )
      : (gcm(key.bytes, nonce, additionalData).decrypt(ciphertext) as Bytes)
  },
}

const encryptionContext = {
  forNote(id: string, revision: string, updatedAt: number, resourceIds: string[]) {
    return encoder.encode(JSON.stringify([VERSION, 'note', id, revision, updatedAt, resourceIds]))
  },

  forResource(noteId: string, resourceId: string) {
    return encoder.encode(JSON.stringify([VERSION, 'resource', noteId, resourceId]))
  },
}

function parseRecoveryKey(value: string) {
  const secret = value.trim()
  if (!secret.startsWith(KEY_PREFIX)) throw new Error('Encryption key must start with pn1-')
  const bytes = base58.decode(secret.slice(KEY_PREFIX.length).replace(/-/g, ''))
  if (bytes.length !== 32) throw new Error('Encryption key must contain 32 random bytes')
  return { secret: formatRecoveryKey(bytes), bytes }
}

function formatRecoveryKey(bytes: Bytes) {
  const encoded = base58.encode(bytes)
  const groups = Array.from({ length: Math.ceil(encoded.length / 5) }, (_, index) =>
    encoded.slice(index * 5, index * 5 + 5),
  )
  return KEY_PREFIX + groups.join('-')
}
