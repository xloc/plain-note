import { expect, test } from 'vite-plus/test'
import { EditorState } from 'prosemirror-state'
import { markdownSerializer, schema } from '../src/editor/markdown.ts'
import { trailingParagraph, withTrailingParagraph, withoutTrailingParagraph } from '../src/editor/trailingParagraph.ts'

test('adds an editor-only paragraph after structural content', () => {
  const image = schema.nodes.image.create({ src: 'resource:image-id' })
  const document = withTrailingParagraph(schema.nodes.doc.create(null, image))

  expect(document.content.content.map((node) => node.type.name)).toEqual(['image', 'paragraph'])
  expect(markdownSerializer.serialize(withoutTrailingParagraph(document))).toBe('![](resource:image-id)')
})

test('keeps a trailing paragraph after document changes', () => {
  const paragraph = schema.nodes.paragraph.create(null, schema.text('Text'))
  const document = schema.nodes.doc.create(null, paragraph)
  const state = EditorState.create({ doc: document, plugins: [trailingParagraph] })
  const transaction = state.tr.replaceWith(0, state.doc.content.size, schema.nodes.horizontal_rule.create())
  const updated = state.apply(transaction)

  expect(updated.doc.content.content.map((node) => node.type.name)).toEqual(['horizontal_rule', 'paragraph'])
})

test('does not append another paragraph after ordinary text', () => {
  const paragraph = schema.nodes.paragraph.create(null, schema.text('Text'))
  const document = schema.nodes.doc.create(null, paragraph)

  expect(withTrailingParagraph(document)).toBe(document)
})
