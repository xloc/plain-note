import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { StorageStatus } from '../../../shared/note'
import { getStorageStatus } from '../api'

export const useStorageStatusStore = defineStore('storageStatus', () => {
  const status = ref<StorageStatus>()
  const loading = ref(false)
  const message = ref('')

  async function refresh() {
    loading.value = true
    message.value = ''
    try {
      status.value = await getStorageStatus()
    } catch (error) {
      message.value = error instanceof Error ? error.message : 'Storage status unavailable'
    } finally {
      loading.value = false
    }
  }

  return { status, loading, message, refresh }
})
