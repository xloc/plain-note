<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useCloudSyncStore } from './stores/cloudSync'

useCloudSyncStore() // Start the reactive watchers that coordinate automatic cloud sync.
const auth = useAuthStore()
onMounted(() => void auth.initialize())
</script>

<template>
  <RouterView />
</template>
