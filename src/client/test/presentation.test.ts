import { expect, test } from 'vite-plus/test'
import { formatDateTime } from '../src/presentation.ts'

test('formats older times with local date and minute-level precision', () => {
  const timestamp = new Date(2000, 0, 2, 3, 4, 5).getTime()

  expect(formatDateTime(timestamp)).toBe('2000-01-02 03:04')
})

test('labels times from today', () => {
  const now = new Date()
  const timestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 4, 5).getTime()

  expect(formatDateTime(timestamp)).toBe('03:04')
})
