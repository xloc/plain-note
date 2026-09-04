import { computed } from 'vue'
import { useAuthStore } from './stores/auth'
import { useCloudSyncStore } from './stores/cloudSync'
import { useNotesStore } from './stores/notes'
import { useVaultStore } from './stores/vault'

export type CloudStatusKind = 'off' | 'working' | 'pending' | 'synced' | 'error'

export function useCloudStatus() {
  const auth = useAuthStore()
  const notes = useNotesStore()
  const cloudSync = useCloudSyncStore()
  const vault = useVaultStore()

  const status = computed(() => {
    if (!cloudSync.online || auth.state === 'offline')
      return { kind: 'off' as const, title: 'Offline', detail: 'Local changes will sync when this device is online.' }

    if (auth.state === 'loading')
      return { kind: 'working' as const, title: 'Connecting', detail: 'Checking access to cloud synchronization.' }
    if (auth.state === 'signedOut')
      return { kind: 'off' as const, title: 'Offline', detail: 'Sign in to synchronize local changes with the cloud.' }
    if (auth.state === 'error')
      return { kind: 'error' as const, title: 'Cloud unavailable', detail: auth.message || 'Authentication failed.' }
    if (vault.state === 'loading')
      return { kind: 'working' as const, title: 'Connecting', detail: 'Loading the encryption key.' }
    if (vault.state === 'missing')
      return { kind: 'off' as const, title: 'Local only', detail: 'Add a key to sync with the cloud.' }

    if (notes.syncing) return { kind: 'working' as const, title: 'Syncing', detail: 'Sending and receiving changes.' }
    if (notes.syncMessage === 'Pending' || notes.selectedNote?.syncState === 'pending')
      return { kind: 'pending' as const, title: 'Changes pending', detail: 'Local changes are waiting to synchronize.' }
    if (notes.syncMessage === 'Synced')
      return { kind: 'synced' as const, title: 'Synced', detail: 'Local notes match the cloud.' }
    if (notes.syncMessage === 'Local only')
      return { kind: 'off' as const, title: 'Local only', detail: 'These notes have not synchronized yet.' }

    return { kind: 'error' as const, title: 'Sync problem', detail: notes.syncMessage || 'Synchronization failed.' }
  })

  return { online: computed(() => cloudSync.online), status }
}
