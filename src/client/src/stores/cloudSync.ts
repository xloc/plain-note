import { useOnline } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { ApiSessionRequired } from '../api'
import { useAuthStore } from './auth'
import { useNotesStore } from './notes'

export const useCloudSyncStore = defineStore('cloudSync', () => {
  const auth = useAuthStore()
  const notes = useNotesStore()
  const online = useOnline()
  const canSync = computed(() => online.value && auth.state === 'ready')
  let syncTimer: number | undefined

  async function sync() {
    if (!canSync.value || notes.syncing) return
    try {
      await notes.sync()
    } catch (error) {
      if (error instanceof ApiSessionRequired) auth.signOut()
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

  watch(() => notes.syncRequest, scheduleSync)
  watch(
    [online, () => auth.state, () => notes.ready],
    ([isOnline, authState, notesReady]) => {
      if (isOnline && authState === 'ready' && notesReady) void sync()
    },
  )

  return { online, canSync, sync, resetLocalData }
})
