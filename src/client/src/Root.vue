<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useCloudSyncStore } from './stores/cloudSync'
import { useVaultStore } from './stores/vault'

useCloudSyncStore() // Start the reactive watchers that coordinate automatic cloud sync.
const auth = useAuthStore()
const vault = useVaultStore()

onMounted(() => {
  void auth.initialize()
  void vault.initialize()
})
</script>

<template>
  <RouterView />
</template>
