import DeviceDetector from '@varienos/device-detector-js'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { CLIENT_SESSION_COOKIE, CLIENT_SESSION_HEADER, type AuthStatus } from '../../../shared/auth'

type State = 'loading' | 'ready' | 'signedOut' | 'offline' | 'error'

export const useAuthStore = defineStore('auth', () => {
  const state = ref<State>('loading')
  const message = ref('')
  const status = ref<AuthStatus | null>(null)

  async function initialize() {
    state.value = 'loading'
    try {
      if (!getClientSessionCookie()) {
        signOut()
        return
      }
      const response = await fetch('/api/auth/status')
      if (response.status === 401) {
        signOut()
        return
      }
      status.value = await responseValue<AuthStatus>(response)
      state.value = 'ready'
    } catch (error) {
      if (error instanceof TypeError) {
        state.value = 'offline'
        message.value = 'Offline'
      } else {
        fail(error)
      }
    }
  }

  async function createSession() {
    state.value = 'loading'
    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: await browserName() }),
      })
      await responseValue(response)
      await refresh()
      state.value = 'ready'
    } catch (error) {
      fail(error)
    }
  }

  async function refresh() {
    status.value = await responseValue<AuthStatus>(await fetch('/api/auth/status'))
  }

  async function revokeSession(id: string) {
    await remove(`/api/auth/sessions/${id}`)
    if (id === status.value?.currentSessionId) signOut()
    else await refresh()
  }

  async function revokeAll() {
    await remove('/api/auth/sessions')
    signOut()
  }

  function signOutBestEffort() {
    const currentSessionId = status.value?.currentSessionId
    if (currentSessionId) void remove(`/api/auth/sessions/${currentSessionId}`).catch(() => undefined)
    signOut()
  }

  function signOut() {
    clearClientSessionCookie()
    status.value = null
    state.value = 'signedOut'
    message.value = 'Sign in to synchronize notes'
  }

  function fail(error: unknown) {
    message.value = error instanceof Error ? error.message : 'Authentication failed'
    state.value = 'error'
  }

  return { state, message, status, initialize, createSession, refresh, revokeSession, revokeAll, signOutBestEffort, signOut }
})

async function remove(path: string) {
  const clientKey = getClientSessionCookie()
  const headers = clientKey ? { [CLIENT_SESSION_HEADER]: clientKey } : undefined
  await responseValue(await fetch(path, { method: 'DELETE', headers }))
}

function getClientSessionCookie() {
  return document.cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${CLIENT_SESSION_COOKIE}=`))
    ?.slice(CLIENT_SESSION_COOKIE.length + 1)
}

function clearClientSessionCookie() {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${CLIENT_SESSION_COOKIE}=; SameSite=Strict; Path=/; Max-Age=0${secure}`
}

async function responseValue<T extends object = { ok: true }>(response: Response): Promise<T> {
  let value: T | { error: string }
  try {
    value = (await response.json()) as T | { error: string }
  } catch {
    throw new Error(`Request failed with ${response.status}`)
  }
  if (!response.ok) throw new Error('error' in value ? value.error : `Request failed with ${response.status}`)
  return value as T
}

async function browserName() {
  const detector = new DeviceDetector()
  await detector.awaitHighEntropyValues()

  const device = detector.getDeviceInfo()
  const hints = detector.getHighEntropyValues()
  const model = hints?.model?.trim()
  let name = model || 'Browser'
  if (!model && device.isIOS) name = device.isTablet ? 'iPad' : 'iPhone'
  else if (!model && device.isAndroid) name = device.isTablet ? 'Android tablet' : 'Android phone'
  else if (!model && device.os.name === 'Mac') name = hints?.architecture === 'arm' ? 'Mac Apple Silicon' : 'Mac'
  else if (!model && device.os.name === 'Windows') name = 'Windows PC'
  else if (!model && device.os.name === 'Linux') name = 'Linux PC'

  return device.browser.name ? `${name} · ${device.browser.name}` : name
}
