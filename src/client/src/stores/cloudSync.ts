import { useOnline } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import * as api from '../api'
import { recoveryKey } from '../encryption'
import { useAuthStore } from './auth'
import { useNotesStore } from './notes'
import { useVaultStore } from './vault'

export const useCloudSyncStore = defineStore('cloudSync', () => {
  const auth = useAuthStore()
  const notes = useNotesStore()
  const vault = useVaultStore()
  const online = useOnline()
  const canSync = computed(() => online.value && auth.state === 'ready' && vault.state === 'ready')
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
    window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => void sync(), 700)
  }

  async function resetLocalData() {
    if (notes.syncing) return
    window.clearTimeout(syncTimer)

    auth.signOutBestEffort()

    await notes.resetLocalData()
    await notes.ensureNote()
  }

  async function rotateKey() {
    if (!canSync.value) throw new Error('Sign in and connect to the cloud before rotating the key')
    if (notes.syncing) throw new Error('Wait for synchronization to finish before rotating the key')

    // A successful sync proves that this device has the complete vault before the cloud copy is replaced.
    await notes.sync()
    if (notes.hasPending) throw new Error('Finish synchronizing local changes before rotating the key')

    const secret = recoveryKey.create()
    const replacement = await recoveryKey.import(secret)
    await api.rebuildVault(replacement.id)
    await vault.importSecret(secret)
    await notes.prepareCloudRebuild()
    void sync()
  }

  watch(() => notes.syncRequest, scheduleSync)
  watch(
    [online, () => auth.state, () => vault.state, () => notes.ready],
    ([isOnline, authState, vaultState, notesReady]) => {
      if (isOnline && authState === 'ready' && vaultState === 'ready' && notesReady) void sync()
    },
  )

  return { online, canSync, sync, resetLocalData, rotateKey }
})
