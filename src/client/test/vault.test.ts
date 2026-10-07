import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { recoveryKey } from '@plain-note/shared/encryption'
import { currentVault, useVaultStore } from '../src/stores/vault'

afterEach(() => vi.unstubAllGlobals())

test('keeps a retryable replacement key until rotation finishes', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  setActivePinia(createPinia())
  const vault = useVaultStore()
  const original = recoveryKey.create()
  values.set('plain-note:vault-key', original)
  await vault.initialize()

  const replacement = await vault.stageRotation()
  const retry = await vault.stageRotation()

  expect(vault.hasPendingRotation()).toBe(true)
  expect(retry.id).toBe(replacement.id)
  expect(values.get('plain-note:vault-key')).toBe(original)
  expect(values.get('plain-note:pending-vault-key')).toBe(replacement.secret)

  vault.finishRotation(replacement)

  expect(currentVault().id).toBe(replacement.id)
  expect(values.get('plain-note:vault-key')).toBe(replacement.secret)
  expect(values.has('plain-note:pending-vault-key')).toBe(false)
  expect(vault.hasPendingRotation()).toBe(false)
})
