import { expect, test } from 'vitest'
import { markdownBlocks, mergeMarkdown } from '../src/editor/merge.ts'

test('finds top-level Markdown blocks', () => {
  const fence = String.fromCharCode(96).repeat(3)
  const markdown = [
    '# Heading',
    '',
    'Paragraph',
    '',
    '- one',
    '- two',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    fence,
    'code',
    '',
    'more code',
    fence,
    '',
    '> quote',
  ].join('\n')

  expect(markdownBlocks(markdown)).toEqual([
    '# Heading',
    'Paragraph',
    '- one\n- two',
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
    `${fence}\ncode\n\nmore code\n${fence}`,
    '> quote',
  ])
})

test('uses the changed side when the other side matches the base', () => {
  expect(mergeMarkdown('Base', 'Server', 'Base')).toBe('Server')
  expect(mergeMarkdown('Base', 'Base', 'Device')).toBe('Device')
})

test('keeps an identical concurrent change once', () => {
  expect(mergeMarkdown('Base', 'Same change', 'Same change')).toBe('Same change')
})

test('merges changes to different blocks', () => {
  expect(mergeMarkdown(
    'A\n\nB\n\nC',
    'Server A\n\nB\n\nC',
    'A\n\nB\n\nDevice C',
  )).toBe('Server A\n\nB\n\nDevice C')
})

test('wraps a conflicting block with server content first', () => {
  expect(mergeMarkdown('Base', 'Server', 'Device')).toBe('---\n\nServer\n\n---\n\nDevice\n\n---')
})

test('wraps simultaneous insertions at the same position', () => {
  expect(mergeMarkdown(
    'A\n\nB',
    'A\n\nServer insertion\n\nB',
    'A\n\nDevice insertion\n\nB',
  )).toBe('A\n\n---\n\nServer insertion\n\n---\n\nDevice insertion\n\n---\n\nB')
})

test('wraps both documents when the base document is empty', () => {
  expect(mergeMarkdown('', 'Server document', 'Device document'))
    .toBe('---\n\nServer document\n\n---\n\nDevice document\n\n---')
})

test('keeps separate conflicts separated by an unchanged block', () => {
  expect(mergeMarkdown(
    'A\n\nB\n\nC',
    'Server A\n\nB\n\nServer C',
    'Device A\n\nB\n\nDevice C',
  )).toBe([
    '---',
    'Server A',
    '---',
    'Device A',
    '---',
    'B',
    '---',
    'Server C',
    '---',
    'Device C',
    '---',
  ].join('\n\n'))
})

test('preserves a server document that already contains a conflict', () => {
  const server = [
    '---',
    'Original server',
    '---',
    'First device',
    '---',
  ].join('\n\n')

  const expected = [
    '---',
    '---',
    'Original server',
    '---',
    'First device',
    '---',
    '---',
    'Second device',
    '---',
  ].join('\n\n')

  expect(mergeMarkdown('Base', server, 'Second device')).toBe(expected)
  expect(markdownBlocks(expected).filter(block => block === '---')).toHaveLength(6)
  expect(expected.match(/Original server/g)).toHaveLength(1)
  expect(expected.match(/First device/g)).toHaveLength(1)
  expect(expected.match(/Second device/g)).toHaveLength(1)
})

test('keeps an empty side when deletion conflicts with an edit', () => {
  expect(mergeMarkdown(
    'A\n\nB\n\nC',
    'A\n\nC',
    'A\n\nDevice B\n\nC',
  )).toBe('A\n\n---\n\n---\n\nDevice B\n\n---\n\nC')
})

test('treats a list as one conflicting Markdown block', () => {
  expect(mergeMarkdown(
    '- one\n- two',
    '- server\n- two',
    '- one\n- device',
  )).toBe('---\n\n- server\n- two\n\n---\n\n- one\n- device\n\n---')
})
