<script setup lang="ts">
import {
  IconFile,
  IconFileCode,
  IconFileMusic,
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconPhoto,
  IconVideo,
} from '@tabler/icons-vue'
import { computed, type Component } from 'vue'
import type { NoteResource } from '../../../shared/note'

const props = defineProps<{ resource: NoteResource }>()

const icon = computed<Component>(() => {
  const mime = props.resource.mime
  if (mime.startsWith('image/')) return IconPhoto
  if (mime === 'application/pdf') return IconFileTypePdf
  if (mime.startsWith('audio/')) return IconFileMusic
  if (mime.startsWith('video/')) return IconVideo
  if (mime.startsWith('text/')) return IconFileText
  if (/zip|compressed|archive/.test(mime)) return IconFileZip
  if (/spreadsheet|excel|csv/.test(mime)) return IconFileSpreadsheet
  if (/json|javascript|typescript|xml/.test(mime)) return IconFileCode
  return IconFile
})
</script>

<template>
  <component :is="icon" />
</template>
