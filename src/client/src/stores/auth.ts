import DeviceDetector from '@varienos/device-detector-js'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { CLIENT_SESSION_COOKIE, CLIENT_SESSION_HEADER, type AuthStatus } from '../../../shared/auth'
import { HttpError, request } from '../http'

const SIGN_IN_INTENT = 'plain-note:sign-in'

export const useAuthStore = defineStore('auth', () => {
  // Undefined means the session has not been established; null means it was rejected or signed out.
  const status = ref<AuthStatus | null>()
  const state = computed(() => (status.value === undefined ? 'unknown' : status.value === null ? 'signedOut' : 'ready'))
  const checking = ref(false)
  const message = ref('')
  let initializing: Promise<unknown> | null = null
  let signingOut: Promise<unknown> | null = null
  let version = 0

  function initialize() {
    if (initializing) return initializing
    checking.value = true
    initializing = authenticate(version).finally(() => {
      initializing = null
      checking.value = false
    })
    return initializing
  }

  async function authenticate(checkVersion: number, createSession = false) {
    try {
      if (signingOut) await signingOut
      if (checkVersion !== version) return
      if (createSession) {
        const name = await browserName()
        if (checkVersion !== version) return
        try {
          await request('/api/auth/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          })
        } finally {
          // A stale response can still set cookies. Remove the readable secret after it settles.
          if (checkVersion !== version) clearClientSessionCookie()
        }
        if (checkVersion !== version) return
      }
      const nextStatus = await request<AuthStatus>('/api/auth/status')
      if (checkVersion !== version) return
      status.value = nextStatus
      message.value = ''
      sessionStorage.removeItem(SIGN_IN_INTENT)
    } catch (error) {
      if (checkVersion !== version) return
      if (sessionRequired(error)) {
        status.value = null
        if (!createSession && sessionStorage.getItem(SIGN_IN_INTENT)) {
          sessionStorage.removeItem(SIGN_IN_INTENT)
          await authenticate(checkVersion, true)
        } else signOut()
      } else {
        message.value = error instanceof Error ? error.message : 'Authentication failed'
      }
    }
  }

  async function signIn() {
    const signInVersion = ++version
    // Finish old cookie-changing requests before navigating into a new sign-in.
    await initializing
    await signingOut
    if (signInVersion !== version) return
    sessionStorage.setItem(SIGN_IN_INTENT, '1')
    const url = new URL('/api/auth/login', location.origin)
    url.searchParams.set('redirect', location.pathname + location.search + location.hash)
    location.assign(url)
  }

  async function revokeSession(id: string) {
    await withSession(() => remove(`/api/auth/sessions/${id}`))
    if (id === status.value?.currentSessionId) signOut()
    else await initialize()
  }

  async function revokeAll() {
    await withSession(() => remove('/api/auth/sessions'))
    signOut()
  }

  function signOutBestEffort() {
    const currentSessionId = status.value?.currentSessionId
    if (currentSessionId) {
      signingOut = remove(`/api/auth/sessions/${currentSessionId}`)
        .catch(() => undefined)
        .finally(() => (signingOut = null))
    }
    signOut()
  }

  function signOut() {
    version++
    sessionStorage.removeItem(SIGN_IN_INTENT)
    clearClientSessionCookie()
    status.value = null
    checking.value = false
    message.value = ''
  }

  async function withSession<T>(operation: () => Promise<T>) {
    if (!status.value) {
      await initialize()
      if (!status.value) throw new Error(message.value || 'Sign in to synchronize notes')
    }
    const requestVersion = version
    try {
      return await operation()
    } catch (error) {
      if (requestVersion === version && sessionRequired(error)) signOut()
      throw error
    }
  }

  return {
    state,
    checking,
    message,
    status,
    initialize,
    signIn,
    revokeSession,
    revokeAll,
    signOutBestEffort,
    withSession,
  }
})

function sessionRequired(error: unknown) {
  return error instanceof HttpError && error.status === 401 && error.body?.error === 'session_required'
}

async function remove(path: string) {
  const clientKey = getClientSessionCookie()
  const headers = clientKey ? { [CLIENT_SESSION_HEADER]: clientKey } : undefined
  await request(path, { method: 'DELETE', headers })
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
