<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useCloudSyncStore } from './stores/cloudSync'
import { useVaultStore } from './stores/vault'

useCloudSyncStore() // Start the reactive watchers that coordinate automatic cloud sync.
const auth = useAuthStore()
const vault = useVaultStore()

function refreshAuthentication() {
  if (document.visibilityState === 'visible') void auth.initialize()
}

onMounted(() => {
  void auth.initialize()
  void vault.initialize()
  document.addEventListener('visibilitychange', refreshAuthentication)
  window.addEventListener('online', refreshAuthentication)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', refreshAuthentication)
  window.removeEventListener('online', refreshAuthentication)
})
</script>

<template>
  <RouterView />
</template>
