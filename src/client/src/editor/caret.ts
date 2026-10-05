import type { Node } from 'prosemirror-model'
import { EditorState, Selection } from 'prosemirror-state'

export function restoreCaret(document: Node, position = document.content.size) {
  const resolved = document.resolve(Math.max(0, Math.min(position, document.content.size)))
  return Selection.findFrom(resolved, 1, true) ?? Selection.findFrom(resolved, -1, true) ?? Selection.atEnd(document)
}

export function updateEditorDocument(state: EditorState, document: Node) {
  const start = state.doc.content.findDiffStart(document.content)
  if (start === null) return state
  const end = state.doc.content.findDiffEnd(document.content)!
  // Repeated text can make the common prefix and suffix overlap.
  const overlap = Math.max(0, start - Math.min(end.a, end.b))
  return state.apply(
    state.tr.replace(start, end.a + overlap, document.slice(start, end.b + overlap)).setMeta('addToHistory', false),
  )
}
