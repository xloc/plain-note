<script setup lang="ts">
import { IconInfoCircle, IconRefresh, IconX } from '@tabler/icons-vue'
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { formatDateTime, formatSize } from './presentation'
import { useStorageStatusStore } from './stores/storageStatus'

const storage = useStorageStatusStore()
const route = useRoute()
const router = useRouter()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const usagePercent = computed(() =>
  storage.status ? Math.min(100, (storage.status.usedBytes / storage.status.limitBytes) * 100) : 0,
)
const cutoffPercent = computed(() =>
  storage.status ? Math.min(100, (storage.status.cutoffBytes / storage.status.limitBytes) * 100) : 0,
)
const referencedPercent = computed(() => {
  if (!storage.status?.storedResources) return 0
  return Math.min(100, (storage.status.referencedResources / storage.status.storedResources) * 100)
})
const usageColor = computed(() => {
  if (!storage.status) return 'bg-stone-500'
  if (storage.status.usedBytes >= storage.status.cutoffBytes) return 'bg-red-500'
  if (storage.status.usedBytes >= storage.status.cutoffBytes * 0.75) return 'bg-amber-500'
  return 'bg-stone-500'
})

watch(
  () => route.query.storage === '1',
  async (visible) => {
    if (visible) {
      await nextTick()
      dialog.value?.showModal()
      void storage.refresh()
    } else if (dialog.value?.open) {
      dialog.value.close()
    }
  },
  { immediate: true },
)

function close() {
  if (route.query.storage === '1') {
    void router.replace({ query: { ...route.query, storage: undefined } })
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-[min(44rem,calc(100%-2rem))] rounded-xl bg-white p-0 text-stone-800 shadow-xl backdrop:bg-stone-900/40"
    @click.self="dialog?.close()"
    @close="close"
  >
    <div class="flex max-h-[min(80vh,48rem)] flex-col">
      <header class="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
        <h2 class="text-lg font-semibold">Storage status</h2>
        <div class="flex items-center gap-1">
          <button
            class="cursor-pointer rounded-lg p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-50"
            type="button"
            title="Refresh"
            :disabled="storage.loading"
            @click="storage.refresh()"
          >
            <IconRefresh class="size-5" :class="{ 'animate-spin': storage.loading }" />
          </button>
          <button
            class="cursor-pointer rounded-lg p-1 text-stone-500 hover:bg-stone-100"
            type="button"
            title="Close"
            @click="dialog?.close()"
          >
            <IconX class="size-5" />
          </button>
        </div>
      </header>

      <div class="space-y-3 overflow-y-auto px-5 pt-2 pb-5">
        <p v-if="storage.loading && !storage.status" class="py-8 text-center text-stone-500">Loading storage status…</p>
        <p v-if="storage.message" class="text-red-600">{{ storage.message }}</p>

        <template v-if="storage.status">
          <section class="rounded-lg border border-stone-200 p-3">
            <div class="flex items-center gap-3">
              <h3 class="shrink-0 font-medium whitespace-nowrap">Disk Usage</h3>
              <div class="ml-auto flex min-w-0 items-center gap-3">
                <span class="shrink-0 text-sm whitespace-nowrap text-stone-500">
                  {{ formatSize(storage.status.usedBytes) }} / {{ formatSize(storage.status.limitBytes) }}
                </span>
                <div class="relative h-2 w-36 min-w-0 shrink overflow-hidden rounded-full bg-stone-200">
                  <div class="h-full rounded-full" :class="usageColor" :style="{ width: `${usagePercent}%` }" />
                  <div class="absolute inset-y-0 w-px bg-stone-800" :style="{ left: `${cutoffPercent}%` }" />
                </div>
              </div>
            </div>
            <p class="mt-2 text-sm text-stone-500">Uploads stop at {{ formatSize(storage.status.cutoffBytes) }}.</p>
          </section>

          <section class="rounded-lg border border-stone-200 p-3">
            <div class="flex items-center gap-3">
              <h3 class="shrink-0 font-medium whitespace-nowrap">Resource References</h3>
              <div class="ml-auto flex min-w-0 items-center gap-3">
                <span class="shrink-0 text-sm whitespace-nowrap text-stone-500">
                  {{ storage.status.referencedResources }} ref / {{ storage.status.storedResources }} stored
                </span>
                <div class="h-2 w-36 min-w-0 shrink overflow-hidden rounded-full bg-stone-200">
                  <div class="h-full rounded-full bg-stone-500" :style="{ width: `${referencedPercent}%` }" />
                </div>
              </div>
            </div>
            <p class="mt-2 text-sm text-stone-500">
              Ref resources belong to active notes. Stored resources include every resource object in R2.
            </p>
          </section>

          <section
            v-for="issue in storage.status.issues"
            :key="issue.code"
            class="relative rounded-lg border border-red-200 bg-red-50 p-3"
          >
            <h3 class="pr-7 font-medium text-red-700">Resource cleanup failed</h3>
            <IconInfoCircle class="absolute top-3 right-3 size-5 text-red-600" />
            <p class="mt-1 text-sm text-red-700">
              {{ issue.occurrences }} {{ issue.occurrences === 1 ? 'failure' : 'failures' }}. Last failure:
              {{ formatDateTime(issue.lastOccurredAt) }}. The daily cleanup job will retry.
            </p>
          </section>
        </template>
      </div>
    </div>
  </dialog>
</template>
