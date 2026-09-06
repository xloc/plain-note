import { useOnline } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { SyncGateToken } from '../../../shared/note'
import * as api from '../api'
import { useAuthStore } from './auth'
import { useNotesStore } from './notes'
import { useVaultStore } from './vault'

export const useCloudSyncStore = defineStore('cloudSync', () => {
  const auth = useAuthStore()
  const notes = useNotesStore()
  const vault = useVaultStore()
  const online = useOnline()
  const rebuilding = ref(false)
  const autoSyncReady = computed(
    () => auth.state === 'ready' && vault.state === 'ready' && notes.ready && notes.editable && !rebuilding.value,
  )
  const canSync = computed(() => online.value && autoSyncReady.value)
  let syncTimer: number | undefined
  let gate: SyncGateToken | null = null

  function sync() {
    return runSync(canSync.value)
  }

  async function runSync(ready: boolean) {
    if (!ready || notes.syncing) return
    try {
      await notes.sync()
    } catch (error) {
      if (error instanceof api.ApiSessionRequired) auth.signOut()
    }
  }

  async function listen(signal: AbortSignal) {
    while (!signal.aborted && autoSyncReady.value) {
      try {
        const position = await notes.syncPosition()
        if (signal.aborted || !autoSyncReady.value) return
        const response = await api.waitForChanges(position.generation, position.cursor, gate, signal)
        gate = response.gate
        if (response.changed) await runSync(autoSyncReady.value)
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof api.ApiSessionRequired) {
          auth.signOut()
          return
        }
        if (error instanceof api.ApiAutoSyncPaused) await pauseUntil(error.retryAt)
        else await pauseUntil(Date.now() + 5_000)
      }
    }
  }

  async function pauseUntil(time: number) {
    // The server rejects gate requests too; this timer only prevents a noisy retry loop.
    await new Promise((resolve) => setTimeout(resolve, Math.max(1_000, time - Date.now())))
  }

  function scheduleSync() {
    clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => void sync(), 700)
  }

  async function resetLocalData() {
    if (!notes.editable || notes.syncing) return
    window.clearTimeout(syncTimer)

    auth.signOutBestEffort()

    await notes.resetLocalData()
    await notes.ensureNote()
  }

  async function rotateKey(confirmMissing: (names: string[]) => boolean) {
    if (!canSync.value) throw new Error('Sign in and connect to the cloud before rotating the key')
    if (notes.syncing) throw new Error('Wait for synchronization to finish before rotating the key')

    rebuilding.value = true
    try {
      if (!vault.hasPendingRotation()) {
        // Pause automatic sync so no request can use the old key after the vault replacement starts.
        await notes.sync()
        if (notes.hasPending) throw new Error('Finish synchronizing local changes before rotating the key')
      }

      // A staged key may already be live after a lost response, so retry it before any old-key sync.
      const replacement = await vault.stageRotation()
      if (!(await notes.prepareCloudRebuild(confirmMissing))) return false
      await api.rebuildVault(replacement.id)
      vault.finishRotation(replacement)
      await notes.uploadCloudRebuild()
      return true
    } finally {
      rebuilding.value = false
    }
  }

  async function rebuildCloud(confirmMissing: (names: string[]) => boolean) {
    if (!canSync.value) throw new Error('Sign in and connect to the cloud before rebuilding it')
    if (notes.syncing) throw new Error('Wait for synchronization to finish before rebuilding the cloud')

    clearTimeout(syncTimer)
    rebuilding.value = true
    try {
      // Prepare first so an incomplete device cannot clear the only cloud copy of an attachment.
      if (!(await notes.prepareCloudRebuild(confirmMissing))) return false
      await api.rebuildVault()
      await notes.uploadCloudRebuild()
      return true
    } finally {
      rebuilding.value = false
    }
  }

  watch(() => notes.syncRequest, scheduleSync)
  watch([() => auth.state, () => vault.state, () => notes.ready, () => notes.editable], () => {
    if (autoSyncReady.value) void sync()
  })
  watch(
    autoSyncReady,
    (ready, _, onCleanup) => {
      if (!ready) return
      const controller = new AbortController()
      // Synchronous cleanup stops old-key waits before a rebuild can replace the vault.
      onCleanup(() => controller.abort())
      void listen(controller.signal)
    },
    { flush: 'sync', immediate: true },
  )
  watch(online, (isOnline) => {
    if (isOnline && autoSyncReady.value) void sync()
  })

  return { online, canSync, rebuilding, sync, resetLocalData, rotateKey, rebuildCloud }
})
