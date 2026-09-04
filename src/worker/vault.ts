import { error } from './response.ts'

const VAULT_KEY = 'vault/key.json'
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/

export async function requireVaultKey(request: Request, bucket: R2Bucket) {
  // The vault key ID is a non-sensitive fingerprint: it detects the wrong key but cannot decrypt notes.
  const keyId = request.headers.get('X-Vault-Key-Id')
  if (!isVaultKeyId(keyId)) return error('vault_key_required', 400)

  const stored = await bucket.get(VAULT_KEY)
  if (stored) return (await stored.text()) === keyId ? null : error('vault_key_mismatch', 403)
  if (request.method === 'GET' || request.method === 'HEAD') return null

  const created = await bucket.put(VAULT_KEY, keyId, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    customMetadata: { kind: 'vault-key-id' },
  })
  if (created) return null

  const winner = await bucket.get(VAULT_KEY)
  return winner && (await winner.text()) === keyId ? null : error('vault_key_mismatch', 403)
}

export function isVaultKeyId(value: unknown): value is string {
  return typeof value === 'string' && KEY_ID_PATTERN.test(value)
}

export async function replaceVaultKey(bucket: R2Bucket, keyId: string) {
  await bucket.put(VAULT_KEY, keyId, {
    httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    customMetadata: { kind: 'vault-key-id' },
  })
}
