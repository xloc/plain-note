<script setup lang="ts">
import { IconCloudCheck, IconCloudCog, IconCloudExclamation, IconCloudOff, IconCloudUpload } from '@tabler/icons-vue'
import type { CloudStatusKind } from '../cloudStatus'

defineProps<{ status: CloudStatusKind }>()
</script>

<template>
  <IconCloudOff v-if="status === 'off'" class="text-stone-400" />
  <IconCloudCog v-else-if="status === 'working'" class="text-blue-500" />
  <IconCloudUpload v-else-if="status === 'pending'" class="text-amber-500" />
  <IconCloudCheck v-else-if="status === 'synced'" class="text-green-500" />
  <IconCloudExclamation v-else class="text-red-500" />
</template>
