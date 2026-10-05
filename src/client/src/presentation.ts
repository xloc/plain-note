import type { LocalNote } from './db'

export function noteTitle(content: string) {
  return noteHeading(content)?.[1].trim() || 'Untitled'
}

export function notePreview(content: string, searchTerms: string[] = []) {
  if (searchTerms.length) {
    const text = content.replace(/\s+/g, ' ').trim()
    const lower = text.toLowerCase()
    const match = Math.min(...searchTerms.map((term) => lower.indexOf(term)))
    if (match >= 0) {
      const start = Math.max(0, match - 12)
      const end = start + 80
      return `${start ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
    }
  }
  const heading = noteHeading(content)
  const body = heading ? content.slice(heading[0].length) : content
  return body.replace(/\n+/g, ' ').trim().slice(0, 80) || 'Empty'
}

export function groupNotesByUpdatedAt(notes: LocalNote[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const week = new Date(today)
  week.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const month = new Date(today.getFullYear(), today.getMonth(), 1)

  return [
    { label: 'Today', notes: notes.filter((note) => note.updatedAt >= today.getTime()) },
    {
      label: 'This week',
      notes: notes.filter((note) => note.updatedAt >= week.getTime() && note.updatedAt < today.getTime()),
    },
    {
      label: 'This month',
      notes: notes.filter((note) => note.updatedAt >= month.getTime() && note.updatedAt < week.getTime()),
    },
    {
      label: 'Older',
      notes: notes.filter((note) => note.updatedAt < Math.min(month.getTime(), week.getTime())),
    },
  ].filter((section) => section.notes.length)
}

export const NOTE_LIST_OVERSCAN = 5

export function windowNoteSections(
  sections: ReturnType<typeof groupNotesByUpdatedAt>,
  geometry: {
    scrollTop: number
    viewportHeight: number
    rowHeight: number
    headingHeight: number
    sectionGap: number
    paddingTop: number
  },
) {
  let top = geometry.paddingTop
  return sections.map((section) => {
    const rowsTop = top + geometry.headingHeight
    const count = section.notes.length
    const start = geometry.rowHeight
      ? Math.min(
          count,
          Math.max(0, Math.floor((geometry.scrollTop - rowsTop) / geometry.rowHeight) - NOTE_LIST_OVERSCAN),
        )
      : 0
    const end = geometry.rowHeight
      ? Math.min(
          count,
          Math.max(
            0,
            Math.ceil((geometry.scrollTop + geometry.viewportHeight - rowsTop) / geometry.rowHeight) +
              NOTE_LIST_OVERSCAN,
          ),
        )
      : Math.min(count, 1)
    top = rowsTop + count * geometry.rowHeight + geometry.sectionGap
    return { ...section, start, end, rowsTop }
  })
}

export function formatSize(size?: number) {
  if (size === undefined) return 'Unknown size'
  if (size < 1_000) return `${size} B`
  if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} KB`
  if (size < 1_000_000_000) return `${(size / 1_000_000).toFixed(1)} MB`
  return `${(size / 1_000_000_000).toFixed(1)} GB`
}

export function formatResourceTime(createdAt?: number) {
  return createdAt === undefined ? 'Unknown upload time' : formatDateTime(createdAt)
}

export function formatDateTime(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const time = [date.getHours(), date.getMinutes()].map(pad).join(':')

  if (sameDay(date, today)) return time
  if (sameDay(date, yesterday)) return `Yesterday ${time}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`
}

function noteHeading(content: string) {
  return content.match(/^#\s+([^\n]*?)(?:\s+#+)?\s*(?=\n|$)/)
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}
