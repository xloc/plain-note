import { expect, test } from 'vite-plus/test'
import { mergeTags } from '@plain-note/shared/mergeTags'

test('merges independent tag changes', () => {
  expect(mergeTags(['base', 'removed'], ['base', 'remote'], ['base', 'removed', 'local'])).toEqual([
    'base',
    'remote',
    'local',
  ])
})
