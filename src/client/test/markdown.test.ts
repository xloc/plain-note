import { expect, test } from 'vite-plus/test'
import { bareUrls, markdownParser, markdownSerializer } from '../src/editor/markdown.ts'

test('finds bare URLs without surrounding punctuation', () => {
  expect(bareUrls('See https://example.com/a?b=1, then http://example.org.')).toEqual([
    { from: 4, to: 29, href: 'https://example.com/a?b=1' },
    { from: 36, to: 54, href: 'http://example.org' },
  ])
})

test('keeps bare URLs unchanged through Markdown serialization', () => {
  const markdown = 'See https://example.com.'
  expect(markdownSerializer.serialize(markdownParser.parse(markdown))).toBe(markdown)
})

test('round-trips labeled Markdown links', () => {
  const markdown = 'See [the example](https://example.com).'
  expect(markdownSerializer.serialize(markdownParser.parse(markdown))).toBe(markdown)
})
