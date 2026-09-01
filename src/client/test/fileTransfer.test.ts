import { expect, test } from 'vite-plus/test'
import { Fragment } from 'prosemirror-model'
import { GapCursor } from 'prosemirror-gapcursor'
import { EditorState, NodeSelection } from 'prosemirror-state'
import {
  containsFiles,
  fileInsertionPoint,
  insertTransferredContent,
  transferredFiles,
} from '../src/editor/fileTransfer.ts'
import { schema } from '../src/editor/markdown.ts'

function transfer(files: File[], types = ['Files']) {
  return {
    files: files as unknown as FileList,
    items: files.map((file) => ({ kind: 'file', type: file.type })) as unknown as DataTransferItemList,
    types,
  }
}

test('accepts image and PDF files from an editor-area drop', () => {
  const image = new File(['image'], 'image.png', { type: 'image/png' })
  const pdf = new File(['pdf'], 'document.pdf', { type: 'application/pdf' })
  const dataTransfer = transfer([image, pdf])

  expect(containsFiles(dataTransfer)).toBe(true)
  expect(transferredFiles(dataTransfer)).toEqual([image, pdf])
})

test('does not intercept non-file drags', () => {
  expect(containsFiles(transfer([], ['text/plain']))).toBe(false)
})

test('recognizes dropped files when a browser omits transfer types', () => {
  const pdf = new File(['pdf'], 'document.pdf', { type: 'application/pdf' })
  const dataTransfer = transfer([pdf], [])
  dataTransfer.items = [] as unknown as DataTransferItemList

  expect(containsFiles(dataTransfer)).toBe(true)
})

test('appends repeated block insertions without replacing the selected attachment', () => {
  const image = (src: string) => schema.nodes.image.create({ src })
  const document = schema.topNodeType.create(null, [image('first')])
  let state = EditorState.create({ doc: document, selection: NodeSelection.create(document, 0) })

  for (const src of ['second', 'third']) {
    const transaction = insertTransferredContent(
      state.tr,
      fileInsertionPoint(state.selection),
      Fragment.from(image(src)),
    )
    state = state.apply(transaction)
  }

  expect(state.doc.content.content.map((node) => node.attrs.src)).toEqual(['first', 'second', 'third'])
  expect(state.selection).toBeInstanceOf(GapCursor)
  expect(state.selection.from).toBe(state.doc.content.size)
})
