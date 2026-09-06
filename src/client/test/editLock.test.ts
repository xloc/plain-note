import { afterEach, expect, test, vi } from 'vite-plus/test'
import { claimEditLock } from '../src/editLock'

afterEach(() => vi.unstubAllGlobals())

test('queues a second tab and grants editing only after the writer lock is acquired', async () => {
  let queued: LockGrantedCallback | undefined
  const request = vi.fn(
    async (_name: string, options: LockOptions | LockGrantedCallback, callback?: LockGrantedCallback) => {
      if (typeof options !== 'function') {
        await callback?.(null)
        return
      }
      queued = options
    },
  )
  vi.stubGlobal('navigator', { locks: { request } })
  const acquired = vi.fn()

  await claimEditLock(acquired)

  expect(acquired).not.toHaveBeenCalled()
  expect(queued).toBeDefined()
  void queued?.({ name: 'plain-note:writer', mode: 'exclusive' })
  await vi.waitFor(() => expect(acquired).toHaveBeenCalledOnce())
})
