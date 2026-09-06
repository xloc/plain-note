const LOCK_NAME = 'plain-note:writer'
const hold = () => new Promise<void>(() => {})

export async function claimEditLock(onAcquired: () => void | Promise<void>) {
  if (!navigator.locks) {
    await onAcquired()
    return
  }

  try {
    const acquired = await new Promise<boolean>((resolve, reject) => {
      void navigator.locks
        .request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(false)
            return
          }
          await onAcquired()
          resolve(true)
          // One writer owns IndexedDB until its document closes, preventing cross-tab lost updates.
          await hold()
        })
        .catch(reject)
    })
    if (!acquired) {
      void navigator.locks.request(LOCK_NAME, async () => {
        await onAcquired()
        await hold()
      })
    }
  } catch {
    // Browsers without a functioning lock implementation retain the existing single-tab behavior.
    await onAcquired()
  }
}
