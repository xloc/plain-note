import { useStorage } from '@vueuse/core'

type ScrollPosition = {
  top: number
  rememberedAt: number
}

export class RecentScrollPositions {
  private static readonly limit = 5
  private static readonly lifetime = 5 * 60 * 1000

  private readonly positions = useStorage<Record<string, ScrollPosition>>('plain-note:scroll-positions', {})
  private pending: { documentId: string; top: number } | undefined
  private timer: number | undefined

  save(documentId: string, top: number) {
    this.pending = { documentId, top }
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.flush(), 100)
  }

  restore(documentId: string) {
    const position = this.positions.value[documentId]
    const top = position && Date.now() - position.rememberedAt <= RecentScrollPositions.lifetime ? position.top : 0
    this.remember(documentId, top)
    return top
  }

  flush() {
    window.clearTimeout(this.timer)
    this.timer = undefined
    if (!this.pending) return
    this.remember(this.pending.documentId, this.pending.top)
    this.pending = undefined
  }

  private remember(documentId: string, top: number) {
    const rememberedAt = Date.now()
    this.positions.value = Object.fromEntries(
      [
        [documentId, { top, rememberedAt }],
        ...Object.entries(this.positions.value)
          .filter(
            ([id, position]) =>
              id !== documentId && rememberedAt - position.rememberedAt <= RecentScrollPositions.lifetime,
          )
          .sort(([, left], [, right]) => right.rememberedAt - left.rememberedAt),
      ].slice(0, RecentScrollPositions.limit),
    )
  }
}
