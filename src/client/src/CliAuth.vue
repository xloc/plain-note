<script setup lang="ts">
import { IconCheck, IconTerminal2 } from '@tabler/icons-vue'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { CliAuthorization } from '../../shared/auth'
import { request } from './http'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const route = useRoute()
const approved = ref(false)
const approving = ref(false)
const message = ref('')
const authorization = computed<CliAuthorization>(() => ({
  id: String(route.query.id ?? ''),
  challenge: String(route.query.challenge ?? ''),
  name: String(route.query.name ?? ''),
}))
const valid = computed(
  () =>
    /^[0-9a-f-]{36}$/.test(authorization.value.id) &&
    /^[A-Za-z0-9_-]{43}$/.test(authorization.value.challenge) &&
    authorization.value.name.length > 0 &&
    authorization.value.name.length <= 100,
)

async function approve() {
  approving.value = true
  try {
    await auth.withSession(() =>
      request('/api/auth/cli/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authorization.value),
      }),
    )
    approved.value = true
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Authorization failed'
  } finally {
    approving.value = false
  }
}
</script>

<template>
  <main class="grid min-h-dvh place-items-center bg-stone-100 p-4 text-stone-800">
    <section class="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
      <header class="mb-5 flex items-center gap-3">
        <IconTerminal2 class="size-6 shrink-0 text-violet-500" />
        <h1 class="text-lg font-semibold">Authorize note CLI</h1>
      </header>

      <p v-if="!valid" class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
        This authorization link is invalid. Run <code class="font-mono">note auth</code> again to start over.
      </p>
      <div v-else-if="approved" class="flex items-start gap-3 rounded-lg bg-stone-50 p-3">
        <IconCheck class="size-5 shrink-0 text-green-600" />
        <div>
          <p class="font-medium">Approved</p>
          <p class="mt-1 text-sm text-stone-500">Return to your terminal to finish setup.</p>
        </div>
      </div>
      <div v-else class="space-y-4">
        <div class="rounded-lg bg-stone-50 p-3">
          <p class="text-sm text-stone-500">Session</p>
          <p class="mt-1 font-medium break-all">{{ authorization.name }}</p>
        </div>
        <div>
          <p class="text-sm text-stone-500">Confirm that your terminal shows this code:</p>
          <code
            class="mt-2 block rounded-lg border border-stone-200 px-3 py-3 text-center font-mono text-2xl tracking-wide text-violet-700 select-all"
          >
            {{ authorization.challenge.slice(0, 8) }}
          </code>
        </div>
        <p class="text-sm text-stone-500">
          Approve only a request you started. This session can synchronize your vault for 30 days, or until revoked.
        </p>
        <p v-if="message || auth.message" class="text-sm break-words text-red-600">{{ message || auth.message }}</p>
        <div class="flex justify-end">
          <button
            v-if="auth.state === 'ready'"
            class="cursor-pointer rounded-lg bg-violet-100 px-3 py-2 font-medium text-violet-700 hover:bg-violet-200 disabled:cursor-default disabled:opacity-50"
            type="button"
            :disabled="approving"
            @click="approve"
          >
            {{ approving ? 'Approving…' : 'Approve CLI' }}
          </button>
          <button
            v-else-if="auth.state === 'signedOut'"
            class="cursor-pointer rounded-lg bg-violet-100 px-3 py-2 font-medium text-violet-700 hover:bg-violet-200"
            type="button"
            @click="auth.signIn"
          >
            Sign in
          </button>
          <button
            v-else
            class="cursor-pointer rounded-lg bg-stone-100 px-3 py-2 text-stone-700 hover:bg-stone-200 disabled:cursor-default disabled:opacity-50"
            type="button"
            :disabled="auth.checking"
            @click="auth.initialize"
          >
            {{ auth.checking ? 'Checking session…' : 'Check session' }}
          </button>
        </div>
      </div>
    </section>
  </main>
</template>
