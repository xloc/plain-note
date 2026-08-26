<script setup lang="ts">
import { baseKeymap, chainCommands, setBlockType, toggleMark } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import { defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown'
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
import { type Command, EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [content: string] }>()
const { schema } = defaultMarkdownParser
const { bullet_list: bulletList, hard_break: hardBreak, list_item: listItem, ordered_list: orderedList, paragraph } = schema.nodes

const editor = ref<HTMLElement | null>(null)
let view: EditorView | undefined

const paragraphEnter: Command = (state, dispatch) => {
  const { $from, $to, empty } = state.selection
  // if outside plain paragraphs, fall back to default
  if (!$from.sameParent($to) || $from.parent.type !== paragraph || $from.node(-1).type === listItem)
    return false

  const previous = empty ? $from.nodeBefore : null
  if (previous?.type === hardBreak) {
    // Second Enter: paragraph break
    const breakPosition = $from.pos - previous.nodeSize
    if (dispatch)
      dispatch(state.tr.delete(breakPosition, $from.pos).split(breakPosition).scrollIntoView())
  }
  else if (dispatch) {
    // First Enter: inline break
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView())
  }

  return true
}

function plugins() {
  return [
    history(),
    inputRules({
      rules: [
        textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, match => ({ level: match[1].length })),
        wrappingInputRule(/^\s*([-+*])\s$/, bulletList),
        wrappingInputRule(/^(\d+)\.\s$/, orderedList, match => ({ order: Number(match[1]) }),
          (match, node) => node.childCount + node.attrs.order === Number(match[1])),
      ],
    }),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      'Mod-b': toggleMark(schema.marks.strong),
      'Mod-i': toggleMark(schema.marks.em),
      Enter: chainCommands(splitListItem(listItem), paragraphEnter),
      Tab: sinkListItem(listItem),
      'Shift-Tab': liftListItem(listItem),
      'Mod-Alt-0': setBlockType(paragraph),
      'Mod-Alt-1': setBlockType(schema.nodes.heading, { level: 1 }),
      'Mod-Alt-2': setBlockType(schema.nodes.heading, { level: 2 }),
      'Mod-Alt-3': setBlockType(schema.nodes.heading, { level: 3 }),
      'Mod-Alt-4': setBlockType(schema.nodes.heading, { level: 4 }),
      'Mod-Alt-5': setBlockType(schema.nodes.heading, { level: 5 }),
      'Mod-Alt-6': setBlockType(schema.nodes.heading, { level: 6 }),
    }),
    keymap(baseKeymap),
  ]
}

function markdown() {
  return view ? defaultMarkdownSerializer.serialize(view.state.doc) : ''
}

onMounted(() => {
  view = new EditorView(editor.value!, {
    attributes: { class: 'min-h-full p-4 outline-none' },
    state: EditorState.create({
      doc: defaultMarkdownParser.parse(props.modelValue),
      plugins: plugins(),
    }),
    dispatchTransaction(transaction) {
      view!.updateState(view!.state.apply(transaction))
      if (transaction.docChanged)
        emit('update:modelValue', markdown())
    },
  })
})

watch(() => props.modelValue, (content) => {
  if (!view || content === markdown())
    return
  view.updateState(EditorState.create({
    doc: defaultMarkdownParser.parse(content),
    plugins: plugins(),
  }))
})

onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="editor" />
</template>

<style scoped>
:deep(.ProseMirror p),
:deep(.ProseMirror ul),
:deep(.ProseMirror ol) {
  --pm-paragraph-gap: calc(2 * var(--spacing));
  margin: 0 0 var(--pm-paragraph-gap);
}

:deep(.ProseMirror p) {
  line-height: 1.5;
}

:deep(.ProseMirror li p) {
  margin: 0;
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
  background: linear-gradient(currentColor, currentColor) calc(1rem + var(--heading-label-line-gap)) center / calc(100% - 1rem - var(--heading-label-line-gap)) 1px no-repeat;
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

:deep(.ProseMirror blockquote) {
  border-left: 0.25rem solid currentColor;
  margin: 0 0 1rem;
  padding-left: 1rem;
}

:deep(.ProseMirror code) {
  font-family: monospace;
}

:deep(.ProseMirror pre) {
  margin: 0 0 1rem;
  overflow: auto;
  padding: 1rem;
}
</style>
