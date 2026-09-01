import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown'
import { Schema, type Node as ProseMirrorNode, type NodeSpec } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'
import {
  detailsAsBlockquotes,
  detailsFromBlockquote,
  detailsNode,
  detailsSummaryNode,
  serializeDetails,
  serializeDetailsSummary,
} from './detailsMarkdown'

export const tabCharacter = '\t'
const bareUrlPattern = /https?:\/\/[^\s<>()\[\]{}]*[^\s<>()\[\]{},.!?;:'"]/g
const emptyParagraphMarker = '\uE000plain-note-empty-paragraph\uE001'

export function bareUrls(text: string) {
  return Array.from(text.matchAll(bareUrlPattern), (match) => ({
    from: match.index,
    to: match.index + match[0].length,
    href: match[0],
  }))
}

const tables = tableNodes({
  cellAttributes: {},
  cellContent: 'inline*',
  tableGroup: 'block',
})
const imageAttributes = {
  src: { validate: 'string' },
  alt: { default: null, validate: 'string|null' },
  title: { default: null, validate: 'string|null' },
  width: { default: null, validate: 'number|null' },
}
const sourceImageNode: NodeSpec = {
  inline: true,
  attrs: imageAttributes,
  group: 'inline',
}
const imageNode: NodeSpec = {
  attrs: imageAttributes,
  group: 'block',
  draggable: true,
  parseDOM: [
    {
      tag: 'img[src]',
      getAttrs(element: HTMLElement) {
        const percentage = element.style.width.match(/^(\d+(?:\.\d+)?)%$/)
        const width = percentage ? Number(percentage[1]) / 100 : null
        return {
          src: element.getAttribute('src'),
          alt: element.getAttribute('alt'),
          title: element.getAttribute('title'),
          width: width && width <= 1 ? width : null,
        }
      },
    },
  ],
  toDOM(node) {
    const attributes: Record<string, string> = {
      src: node.attrs.src,
    }
    if (node.attrs.alt) attributes.alt = node.attrs.alt
    if (node.attrs.title) attributes.title = node.attrs.title
    if (node.attrs.width !== null) attributes.style = `width: ${node.attrs.width * 100}%`
    return ['img', attributes]
  },
}
const resourceNode: NodeSpec = {
  group: 'block',
  atom: true,
  draggable: true,
  attrs: {
    id: { validate: 'string' },
    name: { validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'figure[data-resource-id]',
      getAttrs(element: HTMLElement) {
        return {
          id: element.dataset.resourceId,
          name: element.dataset.resourceName ?? '',
        }
      },
    },
  ],
  toDOM(node) {
    return [
      'figure',
      {
        'data-resource-id': node.attrs.id,
        'data-resource-name': node.attrs.name,
      },
    ]
  },
}
const sourceSchema = new Schema({
  nodes: defaultMarkdownParser.schema.spec.nodes
    .update('image', sourceImageNode)
    .addBefore('image', 'resource', resourceNode)
    .append(tables),
  marks: defaultMarkdownParser.schema.spec.marks,
})

export const schema = new Schema({
  nodes: defaultMarkdownParser.schema.spec.nodes
    .update('image', imageNode)
    .update('heading', {
      ...defaultMarkdownParser.schema.spec.nodes.get('heading'),
      content: 'inline*',
    })
    .addBefore('blockquote', 'details', detailsNode)
    .addBefore('text', 'details_summary', detailsSummaryNode)
    .addBefore('image', 'resource', resourceNode)
    .append(tables),
  marks: defaultMarkdownParser.schema.spec.marks,
})

/** Returns the ID from a resource image source, e.g. `resource:abc123` becomes `abc123`. */
export function imageResourceId(src: unknown) {
  if (typeof src !== 'string') return undefined
  return src.match(/^resource:([A-Za-z0-9_-]+)$/)?.[1]
}

const tokenizer = defaultMarkdownParser.tokenizer.enable('table')
tokenizer.block.ruler.before('paragraph', 'resource', (state, startLine, _endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const end = state.eMarks[startLine]
  const source = state.src.slice(start, end)
  const match = source.match(/^\[((?:\\.|[^\]])*)\]\(resource:([A-Za-z0-9_-]+)\)\s*$/)
  if (!match) return false
  if (silent) return true

  const token = state.push('resource', 'resource', 0)
  token.block = true
  token.map = [startLine, startLine + 1]
  token.meta = {
    id: match[2],
    name: match[1].replace(/\\(.)/g, '$1'),
  }
  state.line = startLine + 1
  return true
})

const sourceMarkdownParser = new MarkdownParser(sourceSchema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  image: {
    node: 'image',
    getAttrs(token, tokens, index) {
      let width: number | null = null
      const suffix = tokens[index + 1]
      const match = suffix?.type === 'text' ? suffix.content.match(/^\{width=(0?\.\d+|1(?:\.0+)?)\}/) : null
      if (match) {
        const value = Number(match[1])
        if (value > 0 && value <= 1) {
          width = value
          suffix.content = suffix.content.slice(match[0].length)
        }
      }
      return {
        src: token.attrGet('src'),
        title: token.attrGet('title') || null,
        alt: token.children?.[0]?.content ?? null,
        width,
      }
    },
  },
  resource: { node: 'resource', getAttrs: (token) => token.meta },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_cell' },
  td: { block: 'table_cell' },
})

function markdownForParser(markdown: string) {
  const withEmptyParagraphMarkers = markdown.replace(/^<p><\/p>\r?$/gm, emptyParagraphMarker)
  return detailsAsBlockquotes(withEmptyParagraphMarkers)
}

function trimInlineEdges(content: ProseMirrorNode[]) {
  const trimmed = [...content]
  const first = trimmed[0]
  if (first?.isText) {
    const text = first.text!.replace(/^\s+/, '')
    if (text) trimmed[0] = schema.text(text, first.marks)
    else trimmed.shift()
  }
  const last = trimmed[trimmed.length - 1]
  if (last?.isText) {
    const text = last.text!.replace(/\s+$/, '')
    if (text) trimmed[trimmed.length - 1] = schema.text(text, last.marks)
    else trimmed.pop()
  }
  return trimmed
}

function convertMarkdownNodes(node: ProseMirrorNode): ProseMirrorNode[] {
  const marks = node.marks.map((mark) => schema.marks[mark.type.name].create(mark.attrs))
  if (node.isText) return [schema.text(node.text!, marks)]

  if (node.type.name === 'paragraph' && node.textContent === emptyParagraphMarker) {
    return [schema.nodes.paragraph.create()]
  }

  if (node.type.name === 'paragraph') {
    let hasImage = false
    node.forEach((child) => {
      if (child.type.name === 'image') hasImage = true
    })
    if (!hasImage) {
      const content: ProseMirrorNode[] = []
      node.forEach((child) => content.push(...convertMarkdownNodes(child)))
      return [schema.nodes.paragraph.create(node.attrs, content, marks)]
    }

    const blocks: ProseMirrorNode[] = []
    let inline: ProseMirrorNode[] = []
    const flushInline = () => {
      const content = trimInlineEdges(inline)
      if (content.length) {
        blocks.push(schema.nodes.paragraph.create(null, content))
      }
      inline = []
    }
    node.forEach((child) => {
      if (child.type.name === 'image') {
        flushInline()
        blocks.push(schema.nodes.image.create(child.attrs))
      } else {
        inline.push(...convertMarkdownNodes(child))
      }
    })
    flushInline()
    return blocks.length ? blocks : [schema.nodes.paragraph.create()]
  }

  const details = detailsFromBlockquote(node, schema, convertMarkdownNodes)
  if (details) return [details]

  const content: ProseMirrorNode[] = []
  node.forEach((child) => content.push(...convertMarkdownNodes(child)))
  return [schema.nodes[node.type.name].create(node.attrs, content, marks)]
}

export const markdownParser = {
  tokenizer: {
    parse(markdown: string, environment: object) {
      return sourceMarkdownParser.tokenizer.parse(markdownForParser(markdown), environment)
    },
  },
  parse(markdown: string) {
    return convertMarkdownNodes(sourceMarkdownParser.parse(markdownForParser(markdown)))[0]
  },
}

export function referencedResourceIds(markdown: string) {
  const ids = new Set<string>()
  markdownParser.parse(markdown).descendants((node) => {
    if (node.type === schema.nodes.resource) ids.add(node.attrs.id)
    if (node.type === schema.nodes.image) {
      const id = imageResourceId(node.attrs.src)
      if (id) ids.add(id)
    }
  })
  return ids
}

export const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    paragraph(state, node, parent, index) {
      if (!node.childCount) {
        state.write('<p></p>')
        state.closeBlock(node)
        return
      }
      defaultMarkdownSerializer.nodes.paragraph(state, node, parent, index)
    },
    details: serializeDetails,
    details_summary: serializeDetailsSummary,
    image(state, node, parent, index) {
      defaultMarkdownSerializer.nodes.image(state, node, parent, index)
      if (node.attrs.width !== null) {
        state.write(`{width=${Math.round(node.attrs.width * 100) / 100}}`)
      }
      state.closeBlock(node)
    },
    resource(state, node) {
      const name = state.esc(node.attrs.name)
      state.write(`[${name}](resource:${node.attrs.id})`)
      state.closeBlock(node)
    },
    table(state, node) {
      node.forEach((row, _, rowIndex) => {
        state.write('|')
        row.forEach((cell) => {
          state.write(' ')
          state.renderInline(cell, false)
          state.write(' |')
        })
        state.ensureNewLine()

        if (rowIndex === 0) {
          state.write(`|${' --- |'.repeat(row.childCount)}`)
          state.ensureNewLine()
        }
      })
      state.closeBlock(node)
    },
    text(state, node, parent, index) {
      node.text!.split(tabCharacter).forEach((text, segmentIndex) => {
        if (segmentIndex) state.write('&#9;')
        if (text) {
          defaultMarkdownSerializer.nodes.text(state, schema.text(text, node.marks), parent, index)
        }
      })
    },
  },
  defaultMarkdownSerializer.marks,
  { escapeExtraCharacters: /[|]/g },
)
