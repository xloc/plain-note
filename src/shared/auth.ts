export const SESSION_COOKIE = 'PlainNoteSession'
export const CLIENT_SESSION_COOKIE = 'PlainNoteClientSession'
export const CLIENT_SESSION_HEADER = 'X-Session-Key'

export type AppSession = {
  id: string
  name: string
  createdAt: number
  expiresAt: number
  current: boolean
}

export type AuthStatus = {
  currentSessionId: string
  sessions: AppSession[]
}
