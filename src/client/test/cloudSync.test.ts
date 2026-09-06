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
      prepareCloudRebuild: vi.fn(async () => void events.push('prepare')),
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

  await useCloudSyncStore().rotateKey()

  expect(fakes.events).toEqual(['stage', 'rebuild', 'finish', 'prepare', 'sync'])
})
