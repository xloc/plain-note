import type { SyncGateToken } from '../shared/note.ts'
import { canUseSyncGate, type UsageEnv } from './usage.ts'

const WAIT_MS = 25_000
const GATE_NAME = 'vault'

export type SyncGateEnv = {
  SYNC_GATE: DurableObjectNamespace
}

export class SyncGate implements DurableObject {
  // A restart changes generation so clients never wait on a lost in-memory version.
  private readonly generation = crypto.randomUUID()
  private version = 0
  private readonly waiters = new Set<() => void>()

  async fetch(request: Request) {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/change') {
      this.version++
      for (const wake of this.waiters) wake()
      return Response.json(this.token())
    }
    if (request.method !== 'GET' || url.pathname !== '/wait') return new Response(null, { status: 404 })

    const previous = {
      generation: url.searchParams.get('generation'),
      version: Number(url.searchParams.get('version')),
    }
    if (previous.generation === this.generation && previous.version === this.version) await this.wait()
    return Response.json(this.token())
  }

  private token(): SyncGateToken {
    return { generation: this.generation, version: this.version }
  }

  private wait() {
    return new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timeout)
        this.waiters.delete(wake)
        resolve()
      }
      const timeout = setTimeout(wake, WAIT_MS)
      this.waiters.add(wake)
    })
  }
}

export async function waitForSyncGate(env: SyncGateEnv, previous: SyncGateToken | null): Promise<SyncGateToken> {
  const query = new URLSearchParams({
    generation: previous?.generation ?? '',
    version: String(previous?.version ?? -1),
  })
  const response = await gate(env).fetch(`https://sync-gate/wait?${query}`)
  if (!response.ok) throw new Error(`Sync gate failed with ${response.status}`)
  return response.json()
}

export async function notifySyncGate(request: Request, env: SyncGateEnv & UsageEnv) {
  // Gate hints are optional, so unavailable quota must never fail an authoritative note write.
  if (!(await canUseSyncGate(request, env))) return
  try {
    await gate(env).fetch('https://sync-gate/change', { method: 'POST' })
  } catch (error) {
    // The D1 check after each wait recovers missed hints, so a gate failure must not fail a committed note write.
    console.error('Sync gate notification failed', error)
  }
}

function gate(env: SyncGateEnv) {
  return env.SYNC_GATE.getByName(GATE_NAME)
}
