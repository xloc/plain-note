import { expect, test } from 'vite-plus/test'
import { bareUrls, markdownParser, markdownSerializer, schema } from '../src/editor/markdown.ts'

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

test('round-trips toggleable regions as details tags', () => {
  const markdown = '<details>\n<summary>Summary</summary>\n\nToggleable content\n\n</details>'
  const document = markdownParser.parse(markdown)
  const details = document.firstChild!

  expect(details.type.name).toBe('details')
  expect(details.attrs.open).toBe(false)
  expect(details.firstChild?.type.name).toBe('details_summary')
  expect(details.firstChild?.textContent).toBe('Summary')
  expect(details.lastChild?.textContent).toBe('Toggleable content')
  expect(markdownSerializer.serialize(document)).toBe(markdown)
})

test('round-trips an expanded toggleable region', () => {
  const markdown = '<details open>\n<summary>Summary</summary>\n\nToggleable content\n\n</details>'
  const document = markdownParser.parse(markdown)

  expect(document.firstChild?.attrs.open).toBe(true)
  expect(markdownSerializer.serialize(document)).toBe(markdown)
})

test('keeps greater-than syntax as a Markdown blockquote', () => {
  const markdown = '> Quoted content'
  const document = markdownParser.parse(markdown)

  expect(document.firstChild?.type.name).toBe('blockquote')
  expect(markdownSerializer.serialize(document)).toBe(markdown)
})

test('round-trips leading, consecutive, and trailing empty paragraphs', () => {
  const document = schema.node('doc', null, [
    schema.node('paragraph'),
    schema.node('paragraph', null, schema.text('First')),
    schema.node('paragraph'),
    schema.node('paragraph'),
    schema.node('paragraph', null, schema.text('Last')),
    schema.node('paragraph'),
  ])

  const markdown = markdownSerializer.serialize(document)
  expect(markdown).toBe('<p></p>\n\nFirst\n\n<p></p>\n\n<p></p>\n\nLast\n\n<p></p>')

  const reparsed = markdownParser.parse(markdown)
  expect(reparsed.toJSON()).toEqual(document.toJSON())
})

test('round-trips empty paragraphs inside toggleable regions', () => {
  const markdown = '<details>\n<summary>Summary</summary>\n\nBefore\n\n<p></p>\n\nAfter\n\n</details>'
  const document = markdownParser.parse(markdown)

  expect(document.firstChild?.child(2).childCount).toBe(0)
  expect(markdownSerializer.serialize(document)).toBe(markdown)
})
