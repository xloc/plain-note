import { expect, test, vi } from 'vite-plus/test'
import { notifySyncGate, SyncGate } from './sync-gate.ts'

const fakes = vi.hoisted(() => ({ capacity: true }))

vi.mock('./usage.ts', () => ({ canUseSyncGate: () => fakes.capacity }))

test('wakes every pending vault listener after a change', async () => {
  const gate = new SyncGate()
  const initial = await token(await gate.fetch(new Request('https://sync-gate/wait')))
  const query = new URLSearchParams({ generation: initial.generation, version: String(initial.version) })
  const first = gate.fetch(new Request(`https://sync-gate/wait?${query}`))
  const second = gate.fetch(new Request(`https://sync-gate/wait?${query}`))

  const changed = await token(await gate.fetch(new Request('https://sync-gate/change', { method: 'POST' })))

  expect(changed.version).toBe(initial.version + 1)
  expect(await token(await first)).toEqual(changed)
  expect(await token(await second)).toEqual(changed)
})

function token(response) {
  expect(response.status).toBe(200)
  return response.json()
}

test('skips change notifications when gate capacity is unavailable', async () => {
  let calls = 0
  const env = {
    SYNC_GATE: {
      getByName: () => ({
        fetch: async () => {
          calls++
          return Response.json({})
        },
      }),
    },
  }

  fakes.capacity = false
  await notifySyncGate(new Request('https://notes.example.com/api/notes/1'), env)
  expect(calls).toBe(0)

  fakes.capacity = true
  await notifySyncGate(new Request('https://notes.example.com/api/notes/1'), env)
  expect(calls).toBe(1)
})
