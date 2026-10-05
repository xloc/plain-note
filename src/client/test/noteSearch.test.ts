import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import type { LocalNote } from '../src/db'
import { useNoteSearch } from '../src/useNoteSearch'

let scope = effectScope()

beforeEach(() => {
  vi.useFakeTimers()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function note(id: string, content: string): LocalNote {
  return {
    id,
    content,
    revision: id,
    tags: [],
    resources: [],
    createdAt: 1,
    updatedAt: 1,
    base: null,
    deleted: false,
    syncState: 'synced',
  }
}

test('scans only enough matches for the viewport, then resumes in order when more are requested', async () => {
  let reads = 0
  const source = shallowRef(
    Array.from({ length: 1_000 }, (_, index) => ({
      ...note(String(index), ''),
      get content() {
        reads++
        return '# Travel\nRemember the passport'
      },
    })),
  )
  const limit = ref(5)
  const search = scope.run(() => useNoteSearch(source, ref('  PASSPORT   travel '), limit))!

  expect(reads).toBe(0)
  await vi.runAllTimersAsync()
  expect(reads).toBe(5)
  expect(search.matches.value.map((record) => record.id)).toEqual(['0', '1', '2', '3', '4'])
  expect(search.complete.value).toBe(false)
  expect(search.searching.value).toBe(false)
  expect(search.showSpinner.value).toBe(false)

  limit.value = 8
  await nextTick()
  await vi.runAllTimersAsync()
  expect(reads).toBe(8)
  expect(search.matches.value.map((record) => record.id)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
})

test('yields during a sparse search and requires every query word', async () => {
  const source = ref(Array.from({ length: 500 }, (_, index) => note(String(index), 'Travel plans')))
  source.value.push(note('match', 'Passport for TRAVEL'))
  const search = scope.run(() => useNoteSearch(source, ref('travel passport'), ref(5)))!

  await vi.advanceTimersToNextTimerAsync()
  expect(search.complete.value).toBe(false)
  expect(search.matches.value).toEqual([])

  await vi.runAllTimersAsync()
  expect(search.matches.value.map((record) => record.id)).toEqual(['match'])
  expect(search.complete.value).toBe(true)
})

test('cancels an unfinished query before accepting results for the new query', async () => {
  const source = ref(Array.from({ length: 500 }, (_, index) => note(String(index), index === 450 ? 'new' : 'old')))
  const query = ref('missing')
  const search = scope.run(() => useNoteSearch(source, query, ref(5)))!
  await vi.advanceTimersToNextTimerAsync()

  query.value = 'new'
  await nextTick()
  await vi.runAllTimersAsync()
  expect(search.matches.value.map((record) => record.id)).toEqual(['450'])
  expect(search.complete.value).toBe(true)
  expect(search.searching.value).toBe(false)
})

test('shows the spinner only after 200 ms of active work and hides it when scanning pauses', async () => {
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += 6))
  const source = ref(Array.from({ length: 500 }, (_, index) => note(String(index), 'No match')))
  const limit = ref(5)
  const search = scope.run(() => useNoteSearch(source, ref('missing'), limit))!

  await vi.advanceTimersByTimeAsync(199)
  expect(search.searching.value).toBe(true)
  expect(search.showSpinner.value).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(search.showSpinner.value).toBe(true)

  limit.value = 0
  await nextTick()
  expect(search.searching.value).toBe(false)
  expect(search.showSpinner.value).toBe(false)
  expect(search.complete.value).toBe(false)

  limit.value = 5
  await nextTick()
  expect(search.showSpinner.value).toBe(false)
  await vi.runAllTimersAsync()
  expect(search.complete.value).toBe(true)
  expect(search.showSpinner.value).toBe(false)
})

test('clearing a search immediately restores the unfiltered notes and cancels pending work', async () => {
  const source = ref(Array.from({ length: 500 }, (_, index) => note(String(index), 'Travel')))
  const query = ref('missing')
  const search = scope.run(() => useNoteSearch(source, query, ref(5)))!

  query.value = '   '
  await nextTick()
  expect(search.matches.value).toBe(source.value)
  expect(search.complete.value).toBe(true)
  expect(search.searching.value).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

test('refreshes matches after an edit or a newly synchronized note', async () => {
  const source = ref([note('one', 'Travel')])
  const search = scope.run(() => useNoteSearch(source, ref('passport'), ref(5)))!
  await vi.runAllTimersAsync()
  expect(search.matches.value).toEqual([])

  source.value[0]!.content = 'Travel with a passport'
  source.value[0]!.revision = 'edited'
  await nextTick()
  await vi.runAllTimersAsync()
  expect(search.matches.value.map((record) => record.id)).toEqual(['one'])

  source.value = [note('two', 'Passport renewal'), ...source.value]
  await nextTick()
  await vi.runAllTimersAsync()
  expect(search.matches.value.map((record) => record.id)).toEqual(['two', 'one'])
})

test('stops scheduled scanning and spinner updates when disposed', () => {
  const source = ref([note('one', 'Travel')])
  const search = scope.run(() => useNoteSearch(source, ref('travel'), ref(5)))!

  scope.stop()
  expect(vi.getTimerCount()).toBe(0)
  expect(search.searching.value).toBe(false)
  expect(search.showSpinner.value).toBe(false)
})
