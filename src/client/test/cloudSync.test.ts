import { createPinia, setActivePinia } from 'pinia'
import { expect, test, vi } from 'vite-plus/test'
import { useCloudSyncStore } from '../src/stores/cloudSync'

const fakes = vi.hoisted(() => {
  const events: string[] = []
  return {
    events,
    auth: { state: 'ready', signOut: vi.fn(), signOutBestEffort: vi.fn() },
    notes: {
      syncing: false,
      hasPending: false,
      editable: true,
      ready: true,
      syncRequest: 0,
      sync: vi.fn(async () => void events.push('sync')),
      resetLocalData: vi.fn(),
      ensureNote: vi.fn(),
      prepareCloudRebuild: vi.fn(async () => {
        events.push('prepare')
        return true
      }),
      uploadCloudRebuild: vi.fn(async () => void events.push('upload')),
    },
    vault: {
      state: 'ready',
      hasPendingRotation: vi.fn(() => true),
      stageRotation: vi.fn(async () => {
        events.push('stage')
        return { id: 'replacement', secret: 'secret', key: {} }
      }),
      finishRotation: vi.fn(() => void events.push('finish')),
    },
    rebuildVault: vi.fn(async () => void events.push('rebuild')),
  }
})

vi.mock('@vueuse/core', async () => {
  const { ref } = await import('vue')
  return { useOnline: () => ref(true) }
})
vi.mock('../src/api', () => ({
  ApiSessionRequired: class extends Error {},
  rebuildVault: fakes.rebuildVault,
}))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => fakes.auth }))
vi.mock('../src/stores/notes', () => ({ useNotesStore: () => fakes.notes }))
vi.mock('../src/stores/vault', () => ({ useVaultStore: () => fakes.vault }))

test('resumes a staged key rotation before trying the old key again', async () => {
  fakes.events.length = 0
  setActivePinia(createPinia())

  await useCloudSyncStore().rotateKey(() => true)

  expect(fakes.events).toEqual(['stage', 'prepare', 'rebuild', 'finish', 'upload'])
})

test('rebuilds the cloud from local data without a server sync', async () => {
  fakes.events.length = 0
  fakes.rebuildVault.mockClear()
  setActivePinia(createPinia())

  await useCloudSyncStore().rebuildCloud(() => true)

  expect(fakes.events).toEqual(['prepare', 'rebuild', 'upload'])
  expect(fakes.rebuildVault).toHaveBeenCalledWith()
})

test('does not clear the cloud when the user cancels for a missing attachment', async () => {
  fakes.events.length = 0
  fakes.rebuildVault.mockClear()
  fakes.notes.uploadCloudRebuild.mockClear()
  fakes.notes.prepareCloudRebuild.mockResolvedValueOnce(false)
  setActivePinia(createPinia())

  await expect(useCloudSyncStore().rebuildCloud(() => false)).resolves.toBe(false)

  expect(fakes.rebuildVault).not.toHaveBeenCalled()
  expect(fakes.notes.uploadCloudRebuild).not.toHaveBeenCalled()
})
