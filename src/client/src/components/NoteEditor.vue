<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { baseKeymap, chainCommands, setBlockType, toggleMark } from 'prosemirror-commands'
import { gapCursor } from 'prosemirror-gapcursor'
import { history, redo, undo } from 'prosemirror-history'
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
import { type Command, EditorState, NodeSelection, Selection, TextSelection } from 'prosemirror-state'
import { CellSelection, deleteColumn, deleteRow, deleteTable, goToNextCell, tableEditing } from 'prosemirror-tables'
import { EditorView } from 'prosemirror-view'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { autoLinks } from '../editor/autoLinks'
import { DetailsView } from '../editor/DetailsView'
import { markdownParser, markdownSerializer, schema, tabCharacter } from '../editor/markdown'
import { RecentScrollPositions } from '../editor/RecentScrollPositions'
import { TableView } from '../editor/TableView'

const props = withDefaults(defineProps<{ documentId: string; modelValue: string; editable?: boolean }>(), {
  editable: true,
})
const emit = defineEmits<{ 'update:modelValue': [content: string] }>()
const {
  blockquote,
  bullet_list: bulletList,
  code_block: codeBlock,
  hard_break: hardBreak,
  horizontal_rule: horizontalRule,
  list_item: listItem,
  ordered_list: orderedList,
  paragraph,
} = schema.nodes
const details = schema.nodes.details
const detailsSummary = schema.nodes.details_summary
const { code, link } = schema.marks
const codeIndentation = ' '.repeat(4)
const scrollPositions = new RecentScrollPositions()

const editor = ref<HTMLElement | null>(null)
let view: EditorView | undefined

function saveScrollPosition() {
  if (!editor.value) return
  scrollPositions.save(props.documentId, editor.value.scrollTop)
}

function restoreScrollPosition(documentId: string) {
  if (!editor.value) return
  editor.value.scrollTop = scrollPositions.restore(documentId)
}

const insertHardBreak: Command = (state, dispatch) => {
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView())
  }
  return true
}

const splitDetailsSummary: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  if (!$from.sameParent($to) || $from.parent.type !== detailsSummary) return false
  if (dispatch) {
    const transaction = state.tr.deleteSelection()
    dispatch(transaction.split(transaction.selection.from, 1, [{ type: paragraph }]).scrollIntoView())
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
        new InputRule(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/, (state, match, start, end) => {
          const linkedText = schema.text(match[1], [link.create({ href: match[2] })])
          const transaction = state.tr.replaceWith(start, end, linkedText)
          return transaction
            .setSelection(TextSelection.create(transaction.doc, start + linkedText.nodeSize))
            .removeStoredMark(link)
            .scrollIntoView()
        }),
        textblockTypeInputRule(/^```$/, codeBlock),
        new InputRule(/^(?:---|___|\*\*\*)$/, (state, _match, start, end) => {
          const transaction = state.tr.replaceWith(start - 1, end, horizontalRule.create())
          return transaction.setSelection(NodeSelection.create(transaction.doc, start - 1))
        }),
        new InputRule(/^>\s$/, (state) => {
          const { $from } = state.selection
          if ($from.depth !== 1 || $from.parent.type !== paragraph) return null
          const position = $from.before()
          const node = details.create({ open: true }, [detailsSummary.create()])
          const transaction = state.tr.replaceWith(position, position + $from.parent.nodeSize, node)
          return transaction.setSelection(TextSelection.create(transaction.doc, position + 2))
        }),
        wrappingInputRule(/^\|\s$/, blockquote),
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
      Enter: chainCommands(splitListItem(listItem), codeBlockEnter, splitDetailsSummary),
      'Shift-Enter': chainCommands(codeBlockEnter, insertHardBreak),
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
    autoLinks,
    tableEditing(),
    gapCursor(),
  ]
}

function markdown() {
  return view ? markdownSerializer.serialize(view.state.doc) : ''
}

function focusEnd(event: MouseEvent) {
  if (!props.editable || !view || (event.target !== view.dom && event.target !== event.currentTarget)) return
  const lastBlock = view.dom.lastElementChild
  if (lastBlock && event.clientY <= lastBlock.getBoundingClientRect().bottom) return
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView())
  view.focus()
}

onMounted(() => {
  view = new EditorView(editor.value!, {
    attributes: { class: 'px-4 py-2 md:pt-[var(--editor-header-space)] outline-none' },
    editable: () => props.editable,
    nodeViews: {
      details: (node, view, getPos) => new DetailsView(node, view, getPos),
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
  restoreScrollPosition(props.documentId)
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
watch(
  () => props.editable,
  (editable) => {
    view?.setProps({ editable: () => editable })
    if (!editable) view?.dom.blur()
  },
)
watch(
  () => props.documentId,
  async (documentId) => {
    scrollPositions.flush()
    await nextTick()
    restoreScrollPosition(documentId)
  },
)

useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState === 'hidden') scrollPositions.flush()
})

onBeforeUnmount(() => {
  scrollPositions.flush()
  view?.destroy()
})
</script>

<template>
  <div ref="editor" class="editor-scroll" @click="focusEnd" @scroll.passive="saveScrollPosition" />
</template>

<style scoped>
/* Section: Note content padding */

.editor-scroll {
  --editor-header-space: 0px;
  --editor-line-height: 1.4;
}

@media (min-width: 48rem) {
  .editor-scroll {
    --editor-header-space: calc(14 * var(--spacing));
  }
}

/* Let the final line scroll below the header. */
.editor-scroll::after {
  content: '';
  display: block;
  height: calc(100% - var(--editor-header-space) - 1lh);
  line-height: var(--editor-line-height);
}

/* Section: General */

:deep(.ProseMirror) {
  --content-indent: 1.5rem;

  tab-size: 4;
  white-space: break-spaces;
}

:deep(.ProseMirror a) {
  color: var(--color-violet-500);
  text-decoration: revert;
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
  line-height: var(--editor-line-height);
}

:deep(.ProseMirror hr) {
  align-items: center;
  border: 0;
  display: flex;
  height: 1lh;
  margin: 0;
}

:deep(.ProseMirror hr::after) {
  border-top: 1px solid currentColor;
  content: '';
  width: 100%;
}

:deep(.ProseMirror li p) {
  margin: 0;
}

:deep(.ProseMirror li ul),
:deep(.ProseMirror li ol) {
  margin-block: 0;
}

:deep(.ProseMirror ul),
:deep(.ProseMirror ol) {
  padding-left: var(--content-indent);
}

:deep(.ProseMirror ul) {
  list-style: disc;
}

:deep(.ProseMirror ol) {
  list-style: decimal;
}

:deep(.ProseMirror details) {
  padding-left: var(--content-indent);
  position: relative;
}

:deep(.ProseMirror details::before) {
  background: color-mix(in srgb, currentColor 25%, transparent);
  bottom: 0;
  content: '';
  left: calc(var(--content-indent) / 2);
  position: absolute;
  top: 1.5em;
  width: 1px;
}

:deep(.ProseMirror details > summary) {
  margin-left: calc(0.5rem - var(--content-indent));
  outline: none;
}

:deep(.ProseMirror blockquote) {
  padding-left: var(--content-indent);
  position: relative;
}

:deep(.ProseMirror blockquote::before) {
  --y-inset: 0;
  background: currentColor;
  bottom: var(--y-inset);
  content: '';
  left: calc((var(--content-indent) - 0.25rem) / 2);
  position: absolute;
  top: var(--y-inset);
  width: 0.25rem;
  border-radius: 999px;
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

/* Section: Headings */

:deep(.ProseMirror h1),
:deep(.ProseMirror h2),
:deep(.ProseMirror h3),
:deep(.ProseMirror h4),
:deep(.ProseMirror h5),
:deep(.ProseMirror h6) {
  --heading-label-line-gap: calc(2 * var(--spacing));

  font-weight: 600;
  line-height: 1.2;
  margin: calc(2 * var(--spacing)) 0;
  overflow: hidden;
  font-size: 1.2rem;
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

/* prettier-ignore */
:deep(.ProseMirror h1::after) { content: 'h1'; }
/* prettier-ignore */
:deep(.ProseMirror h2::after) { content: 'h2'; }
/* prettier-ignore */
:deep(.ProseMirror h3::after) { content: 'h3'; }
/* prettier-ignore */
:deep(.ProseMirror h4::after) { content: 'h4'; }
/* prettier-ignore */
:deep(.ProseMirror h5::after) { content: 'h5'; }
/* prettier-ignore */
:deep(.ProseMirror h6::after) { content: 'h6'; }

/* Section: Tables */

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

:deep(.ProseMirror[contenteditable='false'] .table-controls) {
  display: none;
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
</style>
