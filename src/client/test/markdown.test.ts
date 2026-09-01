import { expect, test } from 'vite-plus/test'
import {
  bareUrls,
  markdownParser,
  markdownSerializer,
  referencedResourceIds,
  schema,
} from '../src/editor/markdown.ts'

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

test('round-trips image resources in automatic sizing mode', () => {
  const markdown = '![Photo](resource:image-id)'
  const document = markdownParser.parse(markdown)
  const image = document.firstChild

  expect(image?.type.name).toBe('image')
  expect(image?.attrs).toEqual({ src: 'resource:image-id', alt: 'Photo', title: null, width: null })
  expect(markdownSerializer.serialize(document)).toBe(markdown)
})

test('round-trips image resources with an explicit document width ratio', () => {
  const markdown = '![Photo](resource:image-id){width=0.7}'
  const document = markdownParser.parse(markdown)

  expect(document.firstChild?.attrs.width).toBe(0.7)
  expect(markdownSerializer.serialize(document)).toBe(markdown)
})

test('uses the same sizing model for remote images', () => {
  const markdown = '![Diagram](https://example.com/diagram.png){width=0.55}'
  const document = markdownParser.parse(markdown)

  expect(document.firstChild?.attrs).toEqual({
    src: 'https://example.com/diagram.png',
    alt: 'Diagram',
    title: null,
    width: 0.55,
  })
  expect(markdownSerializer.serialize(document)).toBe(markdown)
})

test('normalizes imported inline images into blocks', () => {
  const document = markdownParser.parse('Before ![Photo](resource:image-id) after.')

  expect(document.toJSON()).toEqual({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      {
        type: 'image',
        attrs: { src: 'resource:image-id', alt: 'Photo', title: null, width: null },
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'after.' }] },
    ],
  })
  expect(markdownSerializer.serialize(document)).toBe('Before\n\n![Photo](resource:image-id)\n\nafter.')
})

test('round-trips file resources', () => {
  const markdown = '[Report.pdf](resource:file-id)'
  const document = markdownParser.parse(markdown)

  expect(document.firstChild?.type.name).toBe('resource')
  expect(document.firstChild?.attrs).toEqual({ id: 'file-id', name: 'Report.pdf' })
  expect(markdownSerializer.serialize(document)).toBe(markdown)
})

test('finds unique resources referenced by the document', () => {
  const markdown = [
    '![Local image](resource:image-id)',
    '',
    '![Remote image](https://example.com/image.png)',
    '',
    '[Report.pdf](resource:file-id)',
    '',
    '![Same local image](resource:image-id)',
  ].join('\n')

  expect([...referencedResourceIds(markdown)]).toEqual(['image-id', 'file-id'])
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
