import { expect, test } from 'vite-plus/test'
import type { LocalNote } from '../src/db'
import { formatDateTime, notePreview, windowNoteSections } from '../src/presentation.ts'

test('keeps only viewport rows and a small buffer mounted across date groups', () => {
  const notes = Array.from({ length: 100 }, (_, index) => ({ id: String(index) }) as LocalNote)
  const sections = [
    { label: 'Today', notes },
    { label: 'Older', notes },
  ]
  const geometry = {
    scrollTop: 52 + 50 * 65,
    viewportHeight: 390,
    rowHeight: 65,
    headingHeight: 36,
    sectionGap: 24,
    paddingTop: 16,
  }
  const window = windowNoteSections(sections, geometry)

  expect(window[0]!.notes.slice(window[0]!.start, window[0]!.end).map((note) => note.id)).toEqual(
    Array.from({ length: 16 }, (_, index) => String(index + 45)),
  )
  expect(window[1]!.end - window[1]!.start).toBe(0)

  const scrolled = windowNoteSections(sections, { ...geometry, scrollTop: window[1]!.rowsTop + 20 * 65 })
  expect(scrolled[0]!.end - scrolled[0]!.start).toBe(0)
  expect(scrolled[1]!.notes.slice(scrolled[1]!.start, scrolled[1]!.end).map((note) => note.id)).toEqual(
    Array.from({ length: 16 }, (_, index) => String(index + 15)),
  )
})

test('renders a sample row for measurement before the row height is known', () => {
  const notes = Array.from({ length: 1_000 }, (_, index) => ({ id: String(index) }) as LocalNote)
  const [section] = windowNoteSections([{ label: 'Today', notes }], {
    scrollTop: 0,
    viewportHeight: 500,
    rowHeight: 0,
    headingHeight: 0,
    sectionGap: 0,
    paddingTop: 0,
  })

  expect(section!.start).toBe(0)
  expect(section!.end).toBe(1)
})

test('shows a matching excerpt beyond the ordinary note preview', () => {
  const content = `# Trip\n\n${'Introduction. '.repeat(12)}Remember the PASSPORT before leaving. ${'More details. '.repeat(12)}`
  const excerpt = notePreview(content, ['passport'])

  expect(notePreview(content)).not.toContain('PASSPORT')
  expect(excerpt).toContain('PASSPORT before leaving.')
  expect(excerpt.startsWith('…')).toBe(true)
  expect(excerpt.endsWith('…')).toBe(true)
})

test('uses the first match in the note even when query words are in a different order', () => {
  expect(notePreview('# C++ notes\n\nRead about templates.', ['templates', 'c++'])).toBe(
    '# C++ notes Read about templates.',
  )
})

test('restores the ordinary body preview when search is cleared', () => {
  expect(notePreview('# Trip\n\nPack a bag.', ['trip'])).toBe('# Trip Pack a bag.')
  expect(notePreview('# Trip\n\nPack a bag.', [])).toBe('Pack a bag.')
  expect(notePreview('', [])).toBe('Empty')
})

test('formats older times with local date and minute-level precision', () => {
  const timestamp = new Date(2000, 0, 2, 3, 4, 5).getTime()

  expect(formatDateTime(timestamp)).toBe('2000-01-02 03:04')
})

test('labels times from today', () => {
  const now = new Date()
  const timestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 4, 5).getTime()

  expect(formatDateTime(timestamp)).toBe('03:04')
})
