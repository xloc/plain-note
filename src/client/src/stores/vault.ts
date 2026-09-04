import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { recoveryKey, type VaultKey } from '../encryption'

const STORAGE_KEY = 'plain-note:vault-key'

type State = 'loading' | 'missing' | 'ready'

const cached = shallowRef<{ secret: string; key: VaultKey; id: string }>()

export const useVaultStore = defineStore('vault', () => {
  const state = ref<State>('loading')
  const message = ref('')
  const secret = computed(() => (state.value === 'ready' ? current().secret : ''))

  async function initialize() {
    const storedSecret = localStorage.getItem(STORAGE_KEY)
    if (!storedSecret) {
      state.value = 'missing'
      return
    }
    try {
      await useSecret(storedSecret)
    } catch (error) {
      state.value = 'missing'
      message.value = errorMessage(error)
    }
  }

  async function create() {
    await useSecret(recoveryKey.create())
  }

  async function importSecret(secret: string) {
    await useSecret(secret)
  }

  async function useSecret(value: string) {
    try {
      const imported = await recoveryKey.import(value)
      localStorage.setItem(STORAGE_KEY, imported.secret)
      cached.value = imported
      message.value = ''
      state.value = 'ready'
    } catch (error) {
      message.value = errorMessage(error)
      throw error
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(current().secret)
  }

  function download() {
    const blob = new Blob([`${current().secret}\n`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `plain-note-key-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url))
  }

  return { state, message, secret, initialize, create, importSecret, copy, download }
})

export function currentVault() {
  return current()
}

function current() {
  if (!cached.value) throw new Error('Encryption key required')
  return cached.value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Encryption key is not valid'
}
