import type { LocalNote } from './db'

export function noteTitle(content: string) {
  return noteHeading(content)?.[1].trim() || 'Untitled'
}

export function notePreview(content: string) {
  const heading = noteHeading(content)
  const body = heading ? content.slice(heading[0].length) : content
  return body.replace(/\n+/g, ' ').trim().slice(0, 80) || 'Empty'
}

export function formatUpdatedAt(timestamp: number) {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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

function noteHeading(content: string) {
  return content.match(/^#\s+([^\n]*?)(?:\s+#+)?\s*(?=\n|$)/)
}
