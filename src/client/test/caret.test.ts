import { history, undo, undoDepth } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import { expect, test } from 'vite-plus/test'
import { restoreCaret, updateEditorDocument } from '../src/editor/caret'
import { markdownParser, schema } from '../src/editor/markdown'
import { withTrailingParagraph } from '../src/editor/trailingParagraph'

function document(content: string) {
  return withTrailingParagraph(markdownParser.parse(content))
}

test('starts an unfamiliar note at a text insertion point at the end', () => {
  const doc = document('# Heading\n\nBody')
  const selection = restoreCaret(doc)
  const state = EditorState.create({ doc, selection })

  expect(selection).toBeInstanceOf(TextSelection)
  expect(state.apply(state.tr.insertText(' added')).doc.textContent).toBe('HeadingBody added')
})

test('places the caret in the empty paragraph of a new note or after a final attachment', () => {
  const empty = document('')
  expect(restoreCaret(empty).head).toBe(1)

  const image = schema.nodes.image.create({ src: 'resource:photo' })
  const doc = withTrailingParagraph(schema.nodes.doc.create(null, image))
  const selection = restoreCaret(doc)
  const state = EditorState.create({ doc, selection })

  expect(selection).toBeInstanceOf(TextSelection)
  expect(state.apply(state.tr.insertText('Caption')).doc.lastChild?.textContent).toBe('Caption')
})

test('restores a saved insertion point and clamps it when a note has become shorter', () => {
  const doc = document('Hello world')
  const state = EditorState.create({ doc, selection: restoreCaret(doc, 6) })
  expect(state.apply(state.tr.insertText(' there')).doc.textContent).toBe('Hello there world')

  const shorter = document('Hi')
  const restored = EditorState.create({ doc: shorter, selection: restoreCaret(shorter, 99) })
  expect(restored.apply(restored.tr.insertText('!')).doc.textContent).toBe('Hi!')
})

test('finds a text insertion point when a saved offset is now at an attachment boundary', () => {
  const image = schema.nodes.image.create({ src: 'resource:photo' })
  const doc = withTrailingParagraph(schema.nodes.doc.create(null, image))
  const selection = restoreCaret(doc, 0)

  expect(selection).toBeInstanceOf(TextSelection)
  expect(selection.$head.parent.type).toBe(schema.nodes.paragraph)
})

test('maps the active selection through a background insertion before it', () => {
  const doc = document('Hello world')
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 7, 12) })
  const updated = updateEditorDocument(state, document('New Hello world'))

  expect(updated.selection.from).toBe(11)
  expect(updated.selection.to).toBe(16)
  expect(updated.doc.textBetween(updated.selection.from, updated.selection.to)).toBe('world')
})

test('preserves the caret when background content after it changes', () => {
  const doc = document('Hello world')
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 6) })
  const updated = updateEditorDocument(state, document('Hello everyone'))

  expect(updated.selection.head).toBe(6)
  expect(updateEditorDocument(updated, document('Hello everyone'))).toBe(updated)
})

test('handles overlapping common text and structural changes in a background update', () => {
  let state = EditorState.create({ doc: document('aaa') })
  for (const content of ['aaaa', 'aa', '# aa', '- aa\n- bb', '']) {
    const next = document(content)
    state = updateEditorDocument(state, next)
    expect(state.doc.eq(next)).toBe(true)
    expect(state.selection.head).toBeLessThanOrEqual(state.doc.content.size)
  }
})

test('keeps background updates out of undo history while retaining local undo', () => {
  let state = EditorState.create({ doc: document('Hello'), plugins: [history()] })
  state = state.apply(state.tr.insertText('!', 6))
  state = updateEditorDocument(state, document('Hello! remote'))

  expect(undoDepth(state)).toBe(1)
  undo(state, (transaction) => {
    state = state.apply(transaction)
  })
  expect(state.doc.textContent).toBe('Hello remote')
})
