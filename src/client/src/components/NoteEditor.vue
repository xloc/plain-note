<script setup lang="ts">
import { baseKeymap, chainCommands, setBlockType, toggleMark } from 'prosemirror-commands'
import { gapCursor } from 'prosemirror-gapcursor'
import { history, redo, undo } from 'prosemirror-history'
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
import { type Command, EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { CellSelection, deleteColumn, deleteRow, deleteTable, goToNextCell, tableEditing } from 'prosemirror-tables'
import { EditorView } from 'prosemirror-view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { markdownParser, markdownSerializer, schema, tabCharacter } from '../editor/markdown'
import { TableView } from '../editor/TableView'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [content: string] }>()
const {
  bullet_list: bulletList,
  code_block: codeBlock,
  hard_break: hardBreak,
  horizontal_rule: horizontalRule,
  list_item: listItem,
  ordered_list: orderedList,
  paragraph,
} = schema.nodes
const { code } = schema.marks
const codeIndentation = ' '.repeat(4)

const editor = ref<HTMLElement | null>(null)
let view: EditorView | undefined

const paragraphEnter: Command = (state, dispatch) => {
  const { $from, $to, empty } = state.selection
  // if outside plain paragraphs, fall back to default
  if (!$from.sameParent($to) || $from.parent.type !== paragraph || $from.node(-1).type === listItem) {
    return false
  }

  const previous = empty ? $from.nodeBefore : null
  if (previous?.type === hardBreak) {
    // Second Enter: paragraph break
    const breakPosition = $from.pos - previous.nodeSize
    if (dispatch) {
      dispatch(state.tr.delete(breakPosition, $from.pos).split(breakPosition).scrollIntoView())
    }
  } else if (dispatch) {
    // First Enter: inline break
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView())
  }

  return true
}

const insertTable: Command = (state, dispatch) => {
  const { table, table_cell: tableCell, table_row: tableRow } = schema.nodes
  const row = () => tableRow.create(null, [tableCell.create(), tableCell.create(), tableCell.create()])
  const node = table.create(null, [row(), row()])
  if (dispatch) {
    const start = state.selection.from
    const transaction = state.tr.replaceSelectionWith(node)
    const mappedStart = transaction.mapping.map(start, -1)
    let tablePosition = mappedStart
    let found = false
    transaction.doc.nodesBetween(mappedStart, transaction.doc.content.size, (child, position) => {
      if (found || child.type !== table) return
      tablePosition = position
      found = true
      return false
    })
    dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(tablePosition + 1))).scrollIntoView())
  }
  return true
}

const deleteSelectedTablePart: Command = (state, dispatch) => {
  const { selection } = state
  if (!(selection instanceof CellSelection)) return false
  if (selection.isColSelection() && selection.isRowSelection()) return deleteTable(state, dispatch)
  if (selection.isColSelection()) return deleteColumn(state, dispatch)
  if (selection.isRowSelection()) return deleteRow(state, dispatch)
  return false
}

const insertTab: Command = (state, dispatch) => {
  if (dispatch) {
    dispatch(state.tr.insertText(tabCharacter).scrollIntoView())
  }
  return true
}

const removeTab: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (empty && $from.nodeBefore?.isText && $from.nodeBefore.text?.endsWith(tabCharacter) && dispatch) {
    dispatch(state.tr.delete($from.pos - tabCharacter.length, $from.pos).scrollIntoView())
  }
  return true
}

const insertCodeIndentation: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  if (!$from.sameParent($to) || $from.parent.type !== codeBlock) {
    return false
  }
  if (dispatch) {
    dispatch(state.tr.insertText(codeIndentation).scrollIntoView())
  }
  return true
}

const removeCodeIndentation: Command = (state, dispatch) => {
  const { $from, $to, empty } = state.selection
  if (!$from.sameParent($to) || $from.parent.type !== codeBlock) {
    return false
  }
  if (!empty) return true

  const textBefore = $from.parent.textBetween(0, $from.parentOffset)
  const lineStart = textBefore.lastIndexOf('\n') + 1
  const indentation = textBefore.slice(lineStart).match(/^ */)?.[0].length ?? 0
  const length = Math.min(codeIndentation.length, indentation)
  if (length && dispatch) {
    const start = $from.start() + lineStart
    dispatch(state.tr.delete(start, start + length).scrollIntoView())
  }
  return true
}

const codeBlockEnter: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  if (!$from.sameParent($to) || $from.parent.type !== codeBlock) {
    return false
  }

  const textBefore = $from.parent.textBetween(0, $from.parentOffset)
  const line = textBefore.slice(textBefore.lastIndexOf('\n') + 1)
  const indentation = line.match(/^[ \t]*/)?.[0] ?? ''
  if (dispatch) {
    dispatch(state.tr.insertText(`\n${indentation}`).scrollIntoView())
  }
  return true
}

function plugins() {
  return [
    history(),
    inputRules({
      rules: [
        new InputRule(/`([^`\n]+)`$/, (state, match, start, end) => {
          const inlineCode = schema.text(match[1], [code.create()])
          const transaction = state.tr.replaceWith(start, end, inlineCode)
          return transaction
            .setSelection(TextSelection.create(transaction.doc, start + inlineCode.nodeSize))
            .removeStoredMark(code)
            .scrollIntoView()
        }),
        textblockTypeInputRule(/^```$/, codeBlock),
        new InputRule(/^(?:---|___|\*\*\*)$/, (state, _match, start, end) => {
          const transaction = state.tr.replaceWith(start - 1, end, horizontalRule.create())
          return transaction.setSelection(NodeSelection.create(transaction.doc, start - 1))
        }),
        textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({ level: match[1].length })),
        wrappingInputRule(/^\s*([-+*])\s$/, bulletList),
        wrappingInputRule(
          /^(\d+)\.\s$/,
          orderedList,
          (match) => ({ order: Number(match[1]) }),
          (match, node) => node.childCount + node.attrs.order === Number(match[1]),
        ),
      ],
    }),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      'Mod-b': toggleMark(schema.marks.strong),
      'Mod-i': toggleMark(schema.marks.em),
      'Mod-`': toggleMark(code),
      Backspace: deleteSelectedTablePart,
      Delete: deleteSelectedTablePart,
      Enter: chainCommands(splitListItem(listItem), codeBlockEnter, paragraphEnter),
      Tab: chainCommands(goToNextCell(1), sinkListItem(listItem), insertCodeIndentation, insertTab),
      'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(listItem), removeCodeIndentation, removeTab),
      'Mod-Alt-t': insertTable,
      'Mod-Alt-0': setBlockType(paragraph),
      'Mod-Alt-1': setBlockType(schema.nodes.heading, { level: 1 }),
      'Mod-Alt-2': setBlockType(schema.nodes.heading, { level: 2 }),
      'Mod-Alt-3': setBlockType(schema.nodes.heading, { level: 3 }),
      'Mod-Alt-4': setBlockType(schema.nodes.heading, { level: 4 }),
      'Mod-Alt-5': setBlockType(schema.nodes.heading, { level: 5 }),
      'Mod-Alt-6': setBlockType(schema.nodes.heading, { level: 6 }),
    }),
    keymap(baseKeymap),
    tableEditing(),
    gapCursor(),
  ]
}

function markdown() {
  return view ? markdownSerializer.serialize(view.state.doc) : ''
}

onMounted(() => {
  view = new EditorView(editor.value!, {
    attributes: { class: 'min-h-full p-4 pt-8 outline-none' },
    nodeViews: {
      table: (node, view, getPos) => new TableView(node, view, getPos),
    },
    state: EditorState.create({
      doc: markdownParser.parse(props.modelValue),
      plugins: plugins(),
    }),
    dispatchTransaction(transaction) {
      view!.updateState(view!.state.apply(transaction))
      if (transaction.docChanged) {
        emit('update:modelValue', markdown())
      }
    },
  })
})

watch(
  () => props.modelValue,
  (content) => {
    if (!view || content === markdown()) return
    view.updateState(
      EditorState.create({
        doc: markdownParser.parse(content),
        plugins: plugins(),
      }),
    )
  },
)

onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="editor" />
</template>

<style scoped>
:deep(.ProseMirror) {
  tab-size: 4;
  white-space: break-spaces;
}

:deep(.ProseMirror-hideselection) {
  caret-color: transparent;
}

:deep(.ProseMirror-gapcursor) {
  display: none;
  pointer-events: none;
  position: absolute;
}

:deep(.ProseMirror-gapcursor::after) {
  background: currentColor;
  content: '';
  display: block;
  height: 2px;
  position: absolute;
  top: -1px;
  width: 1.25rem;
}

:deep(.ProseMirror-focused .ProseMirror-gapcursor) {
  display: block;
}

:deep(.ProseMirror p),
:deep(.ProseMirror ul),
:deep(.ProseMirror ol),
:deep(.ProseMirror pre) {
  --pm-paragraph-gap: calc(2 * var(--spacing));
  margin: 0 0 var(--pm-paragraph-gap);
}

:deep(.ProseMirror p) {
  line-height: 1.5;
}

:deep(.ProseMirror li p) {
  margin: 0;
}

:deep(.ProseMirror li ul),
:deep(.ProseMirror li ol) {
  margin-block: 0;
}

:deep(.ProseMirror h1),
:deep(.ProseMirror h2),
:deep(.ProseMirror h3),
:deep(.ProseMirror h4),
:deep(.ProseMirror h5),
:deep(.ProseMirror h6) {
  --heading-label-line-gap: calc(2 * var(--spacing));

  font-weight: 600;
  line-height: 1.2;
  margin: 1.5rem 0 0.75rem;
  overflow: hidden;
}

:deep(.ProseMirror h1::after),
:deep(.ProseMirror h2::after),
:deep(.ProseMirror h3::after),
:deep(.ProseMirror h4::after),
:deep(.ProseMirror h5::after),
:deep(.ProseMirror h6::after) {
  background: linear-gradient(currentColor, currentColor) calc(1rem + var(--heading-label-line-gap)) center /
    calc(100% - 1rem - var(--heading-label-line-gap)) 1px no-repeat;
  display: inline-block;
  margin-left: calc(2 * var(--spacing));
  margin-right: -100%;
  opacity: 0.5;
  vertical-align: middle;
  width: 100%;
}

:deep(.ProseMirror h1::after),
:deep(.ProseMirror h2::after),
:deep(.ProseMirror h3::after),
:deep(.ProseMirror h4::after),
:deep(.ProseMirror h5::after),
:deep(.ProseMirror h6::after) {
  font-size: 0.75rem;
  font-weight: 400;
}

:deep(.ProseMirror h1::after) {
  content: 'h1';
}

:deep(.ProseMirror h2::after) {
  content: 'h2';
}

:deep(.ProseMirror h3::after) {
  content: 'h3';
}

:deep(.ProseMirror h4::after) {
  content: 'h4';
}

:deep(.ProseMirror h5::after) {
  content: 'h5';
}

:deep(.ProseMirror h6::after) {
  content: 'h6';
}

:deep(.ProseMirror ul),
:deep(.ProseMirror ol) {
  padding-left: 1.5rem;
}

:deep(.ProseMirror ul) {
  list-style: disc;
}

:deep(.ProseMirror ol) {
  list-style: decimal;
}

:deep(.ProseMirror .tableWrapper) {
  --table-control-size: 1.25rem;

  display: inline-block;
  margin-bottom: calc(2 * var(--spacing));
  position: relative;
  vertical-align: top;
}

:deep(.ProseMirror table) {
  --table-column-min-width: calc(12 * var(--spacing));

  border-collapse: collapse;
}

:deep(.ProseMirror th),
:deep(.ProseMirror td) {
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  min-width: var(--table-column-min-width);
  padding-inline: calc(2 * var(--spacing));
  text-align: left;
  vertical-align: top;
}

:deep(.ProseMirror .selectedCell) {
  background: color-mix(in srgb, currentColor 10%, transparent);
}

:deep(.ProseMirror .table-controls) {
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: 1;
}

:deep(.ProseMirror .table-control) {
  appearance: none;
  background: transparent;
  border: 0;
  color: currentColor;
  opacity: 0;
  pointer-events: auto;
  position: absolute;
}

:deep(.ProseMirror .table-control:hover),
:deep(.ProseMirror .table-control:focus-visible),
:deep(.ProseMirror .table-control.dragging) {
  opacity: 1;
}

:deep(.ProseMirror .tableWrapper.dragging-column .table-column-handle:not(.dragging)),
:deep(.ProseMirror .tableWrapper.dragging-column .table-row-handle),
:deep(.ProseMirror .tableWrapper.dragging-row .table-row-handle:not(.dragging)),
:deep(.ProseMirror .tableWrapper.dragging-row .table-column-handle) {
  visibility: hidden;
}

:deep(.ProseMirror .table-add-column),
:deep(.ProseMirror .table-add-row) {
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  box-sizing: border-box;
  cursor: pointer;
}

:deep(.ProseMirror .table-add-column::before),
:deep(.ProseMirror .table-add-column::after),
:deep(.ProseMirror .table-add-row::before),
:deep(.ProseMirror .table-add-row::after) {
  background: currentColor;
  content: '';
  height: 1px;
  left: 50%;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 0.5rem;
}

:deep(.ProseMirror .table-add-column::after),
:deep(.ProseMirror .table-add-row::after) {
  transform: translate(-50%, -50%) rotate(90deg);
}

:deep(.ProseMirror .table-add-column) {
  border-left: 0;
  width: var(--table-control-size);
}

:deep(.ProseMirror .table-add-row) {
  border-top: 0;
  height: var(--table-control-size);
}

:deep(.ProseMirror .table-column-handle) {
  cursor: grab;
  display: grid;
  gap: 2px;
  grid-template-columns: repeat(3, 2px);
  justify-content: center;
  padding: var(--spacing);
  top: 0;
  touch-action: none;
  transform: translateY(-100%);
}

:deep(.ProseMirror .table-column-handle:active) {
  cursor: grabbing;
}

:deep(.ProseMirror .table-row-handle) {
  align-content: center;
  cursor: grab;
  display: grid;
  gap: 2px;
  grid-template-columns: repeat(2, 2px);
  justify-content: center;
  padding: var(--spacing);
  touch-action: none;
  transform: translateX(-100%);
}

:deep(.ProseMirror .table-row-handle:active) {
  cursor: grabbing;
}

:deep(.ProseMirror .table-handle-dot) {
  background: currentColor;
  border-radius: 50%;
  height: 2px;
  width: 2px;
}

:deep(.ProseMirror .table-column-drop-target) {
  background: var(--color-violet-500, #8b5cf6);
  border-radius: 9999px;
  pointer-events: none;
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  width: 3px;
}

:deep(.ProseMirror .table-row-drop-target) {
  background: var(--color-violet-500, #8b5cf6);
  border-radius: 9999px;
  height: 3px;
  left: 0;
  pointer-events: none;
  position: absolute;
  transform: translateY(-50%);
}

:deep(.ProseMirror blockquote) {
  border-left: 0.25rem solid currentColor;
  margin: 0 0 1rem;
  padding-left: 1rem;
}

:deep(.ProseMirror code) {
  background-color: var(--color-stone-200);
  border-radius: var(--spacing);
  font-family: monospace;
  padding: calc(0.5 * var(--spacing)) var(--spacing);
}

:deep(.ProseMirror pre code) {
  border-radius: 0;
  padding: 0;
}

:deep(.ProseMirror pre) {
  background-color: var(--color-stone-200);
  border-radius: var(--radius-lg);
  line-height: 1.2;
  overflow: auto;
  padding: calc(3 * var(--spacing)) calc(4 * var(--spacing));
}
</style>
