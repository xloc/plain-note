import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown'
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
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
const sourceSchema = new Schema({
  nodes: defaultMarkdownParser.schema.spec.nodes.append(tables),
  marks: defaultMarkdownParser.schema.spec.marks,
})

export const schema = new Schema({
  nodes: defaultMarkdownParser.schema.spec.nodes
    .addBefore('blockquote', 'details', detailsNode)
    .addBefore('text', 'details_summary', detailsSummaryNode)
    .append(tables),
  marks: defaultMarkdownParser.schema.spec.marks,
})

const sourceMarkdownParser = new MarkdownParser(sourceSchema, defaultMarkdownParser.tokenizer.enable('table'), {
  ...defaultMarkdownParser.tokens,
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

function convertMarkdownNode(node: ProseMirrorNode): ProseMirrorNode {
  const marks = node.marks.map((mark) => schema.marks[mark.type.name].create(mark.attrs))
  if (node.isText) return schema.text(node.text!, marks)

  if (node.type.name === 'paragraph' && node.textContent === emptyParagraphMarker) {
    return schema.nodes.paragraph.create()
  }

  const details = detailsFromBlockquote(node, schema, convertMarkdownNode)
  if (details) return details

  const content: ProseMirrorNode[] = []
  node.forEach((child) => content.push(convertMarkdownNode(child)))
  return schema.nodes[node.type.name].create(node.attrs, content, marks)
}

export const markdownParser = {
  tokenizer: {
    parse(markdown: string, environment: object) {
      return sourceMarkdownParser.tokenizer.parse(markdownForParser(markdown), environment)
    },
  },
  parse(markdown: string) {
    return convertMarkdownNode(sourceMarkdownParser.parse(markdownForParser(markdown)))
  },
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
