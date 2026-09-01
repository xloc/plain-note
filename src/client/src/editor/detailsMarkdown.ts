import type { MarkdownSerializerState } from 'prosemirror-markdown'
import type { Node as ProseMirrorNode, NodeSpec, Schema } from 'prosemirror-model'

const openDetailsMarker = '[plain-note-details-open] '
const closedDetailsMarker = '[plain-note-details-closed] '
const detailsBlockPattern = /^<details(?: open)?>\r?\n<summary>([^\r\n]*)<\/summary>\r?\n[\s\S]*?^<\/details>$/gm

export const detailsNode: NodeSpec = {
  attrs: { open: { default: false } },
  content: 'details_summary block*',
  defining: true,
  group: 'block',
  parseDOM: [{ tag: 'details', getAttrs: (element) => ({ open: (element as HTMLDetailsElement).open }) }],
  toDOM: (node) => ['details', node.attrs.open ? { open: '' } : {}, 0],
}

export const detailsSummaryNode: NodeSpec = {
  content: 'inline*',
  defining: true,
  parseDOM: [{ tag: 'summary' }],
  toDOM: () => ['summary', 0],
}

// Convert details tags to marked blockquotes so the Markdown parser can parse their nested content.
// detailsFromBlockquote turns these temporary blockquotes back into details nodes after parsing.
export function detailsAsBlockquotes(markdown: string) {
  return markdown.replace(detailsBlockPattern, (block) => {
    const newline = block.includes('\r\n') ? '\r\n' : '\n'
    const lines = block.split(/\r?\n/)
    const summary = lines[1].slice('<summary>'.length, -'</summary>'.length)
    const body = lines.slice(2, -1)
    const marker = lines[0] === '<details open>' ? openDetailsMarker : closedDetailsMarker
    return [`> ${marker}${summary}`, ...body.map((line) => (line ? `> ${line}` : '>')), '>'].join(newline)
  })
}

export function detailsFromBlockquote(
  node: ProseMirrorNode,
  schema: Schema,
  convertNode: (node: ProseMirrorNode) => ProseMirrorNode[],
) {
  if (node.type.name !== 'blockquote') return

  const first = node.firstChild
  if (first?.type.name !== 'paragraph') return
  const open = first.textContent.startsWith(openDetailsMarker)
  const marker = open ? openDetailsMarker : closedDetailsMarker
  if (!first.textContent.startsWith(marker)) return

  const summaryContent: ProseMirrorNode[] = []
  const body: ProseMirrorNode[] = []
  first.forEach((child, _, index) => {
    if (index === 0 && child.isText) {
      const text = child.text!.slice(marker.length)
      if (text) {
        const marks = child.marks.map((mark) => schema.marks[mark.type.name].create(mark.attrs))
        summaryContent.push(schema.text(text, marks))
      }
    } else {
      summaryContent.push(...convertNode(child))
    }
  })
  node.forEach((child, _, index) => {
    if (index) body.push(...convertNode(child))
  })
  return schema.nodes.details.create({ open }, [schema.nodes.details_summary.create(null, summaryContent), ...body])
}

export function serializeDetails(state: MarkdownSerializerState, node: ProseMirrorNode) {
  state.write(node.attrs.open ? '<details open>' : '<details>')
  state.ensureNewLine()
  state.write('<summary>')
  state.renderInline(node.firstChild!)
  state.write('</summary>')
  state.ensureNewLine()
  state.write('\n')
  for (let index = 1; index < node.childCount; index++) state.render(node.child(index), node, index)
  state.ensureNewLine()
  state.write('</details>')
  state.closeBlock(node)
}

export function serializeDetailsSummary(state: MarkdownSerializerState, node: ProseMirrorNode) {
  state.renderInline(node)
  state.closeBlock(node)
}
