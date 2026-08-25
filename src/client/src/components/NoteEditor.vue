<script setup lang="ts">
import { baseKeymap, toggleMark } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { inputRules, textblockTypeInputRule } from 'prosemirror-inputrules'
import { keymap } from 'prosemirror-keymap'
import { defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [content: string] }>()

const editor = ref<HTMLElement | null>(null)
let view: EditorView | undefined

function plugins() {
  return [
    history(),
    inputRules({
      rules: [
        textblockTypeInputRule(/^(#{1,6})\s$/, defaultMarkdownParser.schema.nodes.heading, match => ({ level: match[1].length })),
      ],
    }),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Mod-Shift-z': redo,
      'Mod-b': toggleMark(defaultMarkdownParser.schema.marks.strong),
      'Mod-i': toggleMark(defaultMarkdownParser.schema.marks.em),
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
:deep(.ProseMirror p) {
  margin: 0 0 1rem;
  line-height: 1.5;
}

:deep(.ProseMirror h1),
:deep(.ProseMirror h2),
:deep(.ProseMirror h3),
:deep(.ProseMirror h4),
:deep(.ProseMirror h5),
:deep(.ProseMirror h6) {
  font-weight: 600;
  line-height: 1.2;
  margin: 1.5rem 0 0.75rem;
}

:deep(.ProseMirror h1::after),
:deep(.ProseMirror h2::after),
:deep(.ProseMirror h3::after),
:deep(.ProseMirror h4::after),
:deep(.ProseMirror h5::after),
:deep(.ProseMirror h6::after) {
  font-size: 0.75rem;
  font-weight: 400;
  margin-left: 0.5rem;
  opacity: 0.5;
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
  margin: 0 0 1rem;
  padding-left: 1.5rem;
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
