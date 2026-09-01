import { Fragment, type Node } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'

function endsInParagraph(document: Node) {
  return document.lastChild?.type === document.type.schema.nodes.paragraph
}

export function withTrailingParagraph(document: Node) {
  if (endsInParagraph(document)) return document
  const paragraph = document.type.schema.nodes.paragraph.create()
  return document.copy(document.content.append(Fragment.from(paragraph)))
}

export function withoutTrailingParagraph(document: Node) {
  const last = document.lastChild
  if (!last || !endsInParagraph(document) || last.childCount) return document
  return document.copy(document.content.cut(0, document.content.size - last.nodeSize))
}

export const trailingParagraph = new Plugin({
  appendTransaction(_transactions, _oldState, state) {
    if (endsInParagraph(state.doc)) return null
    return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create())
  },
})
