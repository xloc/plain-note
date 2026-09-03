<script setup lang="ts">
import { IconX } from '@tabler/icons-vue'
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCloudStatus } from './cloudStatus'
import CloudStatusIcon from './components/CloudStatusIcon.vue'
import { useAuthStore } from './stores/auth'
import { useCloudSyncStore } from './stores/cloudSync'
import { useNotesStore } from './stores/notes'

const auth = useAuthStore()
const notes = useNotesStore()
const cloudSync = useCloudSyncStore()
const cloud = useCloudStatus()
const route = useRoute()
const router = useRouter()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const message = ref('')

watch(
  () => route.query.sessions === '1',
  async (visible) => {
    if (visible) {
      await nextTick()
      dialog.value?.showModal()
      void refresh()
    } else if (dialog.value?.open) {
      dialog.value.close()
    }
  },
  { immediate: true },
)

async function refresh() {
  try {
    await auth.refresh()
    message.value = ''
  } catch (error) {
    message.value = errorMessage(error)
  }
}

async function signIn() {
  await auth.createSession()
  message.value = auth.state === 'ready' ? '' : auth.message
}

async function revokeSession(id: string) {
  if (!window.confirm('Sign out this session?')) return
  try {
    await auth.revokeSession(id)
    message.value = ''
  } catch (error) {
    message.value = errorMessage(error)
  }
}

async function revokeAll() {
  if (!window.confirm('Sign out every app session?')) return
  try {
    await auth.revokeAll()
    message.value = ''
  } catch (error) {
    message.value = errorMessage(error)
  }
}

function close() {
  if (route.query.sessions === '1') {
    void router.replace({ query: { ...route.query, sessions: undefined } })
  }
}

function date(value: number) {
  return value ? new Date(value).toLocaleString() : 'Local development'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed'
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
        <h2 class="text-lg font-semibold">Cloud status</h2>
        <button
          class="cursor-pointer rounded-lg p-1 text-stone-500 hover:bg-stone-100"
          type="button"
          title="Close"
          @click="dialog?.close()"
        >
          <IconX class="size-5" />
        </button>
      </header>

      <div class="overflow-y-auto px-5 py-2">
        <div class="flex items-center gap-3 rounded-lg bg-stone-50 p-3">
          <CloudStatusIcon :status="cloud.status.value.kind" class="size-8 shrink-0" />
          <div class="min-w-0">
            <p class="font-medium">{{ cloud.status.value.title }}</p>
            <p class="text-sm text-stone-500">{{ cloud.status.value.detail }}</p>
          </div>
        </div>
        <button
          v-if="auth.state === 'signedOut' || auth.state === 'error'"
          class="mt-3 cursor-pointer rounded-lg px-3 py-2 hover:bg-stone-100"
          type="button"
          @click="signIn"
        >
          Sign in to view sessions
        </button>
        <button
          v-else-if="cloud.online.value && auth.state === 'ready'"
          class="mt-3 cursor-pointer rounded-lg px-3 py-2 hover:bg-stone-100"
          type="button"
          :disabled="notes.syncing"
          @click="cloudSync.sync"
        >
          Sync now
        </button>
        <p v-if="message" class="mt-3 text-red-600">{{ message }}</p>

        <h3 v-if="auth.status?.sessions.length" class="mt-5 font-medium">Signed-in sessions</h3>
        <ul v-if="auth.status?.sessions.length" class="mt-2 space-y-2">
          <li
            v-for="session in auth.status.sessions"
            :key="session.id"
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 p-3"
          >
            <div class="flex min-w-48 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <span class="order-1 font-medium break-words text-stone-700">{{ session.name }}</span>
              <span
                v-if="session.current"
                class="order-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-700 sm:order-4"
              >
                Current
              </span>
              <span class="order-3 hidden text-stone-400 sm:order-2 sm:inline">—</span>
              <time
                class="order-4 basis-full text-sm text-stone-500 sm:order-3 sm:basis-auto"
                :datetime="new Date(session.createdAt).toISOString()"
              >
                {{ date(session.createdAt) }}
              </time>
            </div>
            <button
              class="ml-auto self-center rounded-lg px-2 py-1 whitespace-nowrap hover:bg-stone-100"
              type="button"
              @click="revokeSession(session.id)"
            >
              Sign out
            </button>
          </li>
        </ul>
      </div>

      <footer v-if="auth.status" class="flex items-center justify-end px-5 pt-3 pb-5">
        <button class="cursor-pointer rounded-lg p-2 text-red-600 hover:bg-red-50" type="button" @click="revokeAll">
          Sign out all sessions
        </button>
      </footer>
    </div>
  </dialog>
</template>
