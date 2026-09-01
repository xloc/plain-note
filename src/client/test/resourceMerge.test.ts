import { expect, test } from 'vite-plus/test'
import type { NoteResource } from '../../shared/note.ts'
import { mergeResources } from '../src/stores/mergeResources.ts'

const first: NoteResource = { id: 'first', name: 'first.txt', mime: 'text/plain', size: 1, createdAt: 1 }
const remoteAddition: NoteResource = {
  id: 'remote',
  name: 'remote.txt',
  mime: 'text/plain',
  size: 2,
  createdAt: 2,
}
const localAddition: NoteResource = {
  id: 'local',
  name: 'local.txt',
  mime: 'text/plain',
  size: 3,
  createdAt: 3,
}

test('keeps a remote removal when local resources are unchanged', () => {
  expect(mergeResources([first], [], [first])).toEqual([])
})

test('keeps a local removal when remote resources are unchanged', () => {
  expect(mergeResources([first], [first], [])).toEqual([])
})

test('merges independent resource additions by UUID', () => {
  expect(mergeResources([first], [first, remoteAddition], [first, localAddition])).toEqual([
    first,
    remoteAddition,
    localAddition,
  ])
})
