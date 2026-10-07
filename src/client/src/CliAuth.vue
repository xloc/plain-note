<script setup lang="ts">
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
  <main>
    <h1>Authorize plain-note CLI</h1>
    <p v-if="!valid">This authorization link is invalid.</p>
    <p v-else-if="approved">Approved. Return to your terminal to finish setup.</p>
    <template v-else>
      <p>Session: {{ authorization.name }}</p>
      <p>
        Confirm that your terminal shows this code: <code>{{ authorization.challenge.slice(0, 8) }}</code>
      </p>
      <p>Approve only a request you started. This session can synchronize your vault for 30 days, or until revoked.</p>
      <button v-if="auth.state === 'ready'" type="button" :disabled="approving" @click="approve">Approve CLI</button>
      <button v-else-if="auth.state === 'signedOut'" type="button" @click="auth.signIn">Sign in</button>
      <button v-else type="button" :disabled="auth.checking" @click="auth.initialize">Check session</button>
      <p v-if="message || auth.message">{{ message || auth.message }}</p>
    </template>
  </main>
</template>
