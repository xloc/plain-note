import { createPinia, setActivePinia } from 'pinia'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { useCloudSyncStore } from '../src/stores/cloudSync'
import { useNotesStore } from '../src/stores/notes'

const fakes = vi.hoisted(() => {
  const events: string[] = []
  return {
    events,
    online: undefined as { value: boolean } | undefined,
    auth: { state: 'ready', signOut: vi.fn(), signOutBestEffort: vi.fn() },
    notes: {
      syncing: false,
      hasPending: false,
      editable: true,
      ready: true,
      syncRequest: 0,
      sync: vi.fn(async () => void events.push('sync')),
      syncPosition: vi.fn(async () => ({ generation: 'generation', cursor: 0 })),
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
    waitForChanges: vi.fn(() => new Promise(() => {})),
  }
})

vi.mock('@vueuse/core', async () => {
  const { ref } = await import('vue')
  fakes.online = ref(true)
  return { useOnline: () => fakes.online }
})
vi.mock('../src/api', () => ({
  ApiAutoSyncPaused: class extends Error {},
  ApiSessionRequired: class extends Error {},
  rebuildVault: fakes.rebuildVault,
  waitForChanges: fakes.waitForChanges,
}))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => fakes.auth }))
vi.mock('../src/stores/notes', async () => {
  const { reactive } = await import('vue')
  const notes = reactive(fakes.notes)
  return { useNotesStore: () => notes }
})
vi.mock('../src/stores/vault', () => ({ useVaultStore: () => fakes.vault }))

let cloudSync: ReturnType<typeof useCloudSyncStore> | undefined

afterEach(() => {
  cloudSync?.$dispose()
  cloudSync = undefined
  fakes.online!.value = true
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test('resumes a staged key rotation before trying the old key again', async () => {
  fakes.events.length = 0
  setActivePinia(createPinia())

  cloudSync = useCloudSyncStore()
  await cloudSync.rotateKey(() => true)

  expect(fakes.events).toEqual(['stage', 'prepare', 'rebuild', 'finish', 'upload'])
})

test('rebuilds the cloud from local data without a server sync', async () => {
  fakes.events.length = 0
  fakes.rebuildVault.mockClear()
  setActivePinia(createPinia())

  cloudSync = useCloudSyncStore()
  await cloudSync.rebuildCloud(() => true)

  expect(fakes.events).toEqual(['prepare', 'rebuild', 'upload'])
  expect(fakes.rebuildVault).toHaveBeenCalledWith()
})

test('does not clear the cloud when the user cancels for a missing attachment', async () => {
  fakes.events.length = 0
  fakes.rebuildVault.mockClear()
  fakes.notes.uploadCloudRebuild.mockClear()
  fakes.notes.prepareCloudRebuild.mockResolvedValueOnce(false)
  setActivePinia(createPinia())

  cloudSync = useCloudSyncStore()
  await expect(cloudSync.rebuildCloud(() => false)).resolves.toBe(false)

  expect(fakes.rebuildVault).not.toHaveBeenCalled()
  expect(fakes.notes.uploadCloudRebuild).not.toHaveBeenCalled()
})

test('stops listening before rebuilding the cloud', async () => {
  fakes.waitForChanges.mockClear()
  fakes.notes.prepareCloudRebuild.mockImplementationOnce(async () => false)
  setActivePinia(createPinia())
  cloudSync = useCloudSyncStore()
  await Promise.resolve()

  const signal = fakes.waitForChanges.mock.calls[0]?.[3] as AbortSignal
  await cloudSync.rebuildCloud(() => false)

  expect(signal.aborted).toBe(true)
})

test('keeps listening when an offline edit cannot upload', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', globalThis)
  fakes.online!.value = false
  fakes.notes.sync.mockClear()
  fakes.waitForChanges.mockClear()
  let notify!: (response: { changed: boolean; gate: { generation: string; version: number } }) => void
  fakes.waitForChanges.mockImplementationOnce(() => new Promise((resolve) => (notify = resolve)))
  setActivePinia(createPinia())
  cloudSync = useCloudSyncStore()
  await Promise.resolve()

  const signal = fakes.waitForChanges.mock.calls[0]?.[3] as AbortSignal

  useNotesStore().syncRequest++
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(700)

  expect(fakes.notes.sync).not.toHaveBeenCalled()
  expect(signal.aborted).toBe(false)
  expect(fakes.waitForChanges).toHaveBeenCalledOnce()

  notify({ changed: true, gate: { generation: 'gate', version: 1 } })
  await vi.waitFor(() => expect(fakes.notes.sync).toHaveBeenCalledOnce())
})
