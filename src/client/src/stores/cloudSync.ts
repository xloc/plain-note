import { useOnline } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
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
  const canSync = computed(
    () => online.value && auth.state === 'ready' && vault.state === 'ready' && notes.editable && !rebuilding.value,
  )
  let syncTimer: number | undefined

  async function sync() {
    if (!canSync.value || notes.syncing) return
    try {
      await notes.sync()
    } catch (error) {
      if (error instanceof api.ApiSessionRequired) auth.signOut()
    }
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
  watch(
    [online, () => auth.state, () => vault.state, () => notes.ready],
    ([isOnline, authState, vaultState, notesReady]) => {
      if (isOnline && authState === 'ready' && vaultState === 'ready' && notesReady) void sync()
    },
  )

  return { online, canSync, rebuilding, sync, resetLocalData, rotateKey, rebuildCloud }
})
