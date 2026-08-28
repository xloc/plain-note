import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown'
import { Schema } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

export const tabCharacter = '\t'

export const schema = new Schema({
  nodes: defaultMarkdownParser.schema.spec.nodes.append(
    tableNodes({
      cellAttributes: {},
      cellContent: 'inline*',
      tableGroup: 'block',
    }),
  ),
  marks: defaultMarkdownParser.schema.spec.marks,
})

export const markdownParser = new MarkdownParser(schema, defaultMarkdownParser.tokenizer.enable('table'), {
  ...defaultMarkdownParser.tokens,
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_cell' },
  td: { block: 'table_cell' },
})

export const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
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
