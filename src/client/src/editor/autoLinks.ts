import { type EditorState, Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { bareUrls, schema } from './markdown'

const { code, link } = schema.marks
const { code_block: codeBlock } = schema.nodes
const autoLinksKey = new PluginKey<DecorationSet>('autoLinks')

function anchorFrom(event: Event) {
  return event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
}

function openLink(href: string) {
  window.open(href, '_blank', 'noopener,noreferrer')
}

function decorations(state: EditorState) {
  const links: Decoration[] = []
  state.doc.descendants((node, position, parent) => {
    if (
      !node.isText ||
      parent?.type === codeBlock ||
      node.marks.some((mark) => mark.type === code || mark.type === link)
    ) {
      return
    }
    for (const url of bareUrls(node.text!)) {
      links.push(
        Decoration.inline(position + url.from, position + url.to, {
          nodeName: 'a',
          href: url.href,
        }),
      )
    }
  })
  return DecorationSet.create(state.doc, links)
}

export const autoLinks = new Plugin<DecorationSet>({
  key: autoLinksKey,
  state: {
    init: (_, state) => decorations(state),
    apply: (transaction, links, _oldState, newState) =>
      transaction.docChanged ? decorations(newState) : links,
  },
  props: {
    decorations: (state) => autoLinksKey.getState(state),
    handleClick: (view, _position, event) => {
      const anchor = anchorFrom(event)
      if (!anchor || (view.editable && !event.metaKey && !event.ctrlKey)) return false
      event.preventDefault()
      openLink(anchor.href)
      return true
    },
  },
})
