<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue'
import { useEventListener } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  anchor?: Element
  text?: string
}>()

const trigger = useTemplateRef<HTMLElement>('trigger')
const panel = useTemplateRef<HTMLElement>('panel')
const visible = ref(false)
const reference = computed(() => props.anchor ?? trigger.value)
const teleportTarget = computed(() => reference.value?.closest('dialog') ?? 'body')
const { floatingStyles } = useFloating(reference, panel, {
  open: visible,
  placement: 'bottom',
  strategy: 'fixed',
  middleware: [offset(8), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
})
let externalAnchor: Element | undefined

function show() {
  visible.value = true
}

function hide() {
  visible.value = false
}

function removeExternalAnchor() {
  if (!externalAnchor) return
  externalAnchor.removeEventListener('mouseenter', show)
  externalAnchor.removeEventListener('mouseleave', hide)
  externalAnchor.removeEventListener('focusin', show)
  externalAnchor.removeEventListener('focusout', hide)
  externalAnchor.removeEventListener('pointerdown', hide)
  externalAnchor = undefined
}

function setExternalAnchor(anchor: Element | undefined) {
  removeExternalAnchor()
  if (!anchor) return
  externalAnchor = anchor
  anchor.addEventListener('mouseenter', show)
  anchor.addEventListener('mouseleave', hide)
  anchor.addEventListener('focusin', show)
  anchor.addEventListener('focusout', hide)
  anchor.addEventListener('pointerdown', hide)
}

watch(() => props.anchor, setExternalAnchor, { immediate: true })
useEventListener(document, 'keydown', (event) => {
  if (event.key === 'Escape') hide()
})
onBeforeUnmount(removeExternalAnchor)
</script>

<template>
  <span
    v-if="!anchor"
    ref="trigger"
    class="inline-flex"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    @pointerdown="hide"
  >
    <slot />
  </span>

  <Teleport :to="teleportTarget">
    <div
      v-if="visible"
      ref="panel"
      class="pointer-events-none z-100"
      :style="floatingStyles"
    >
      <slot name="panel">
        <div class="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm text-stone-800 shadow-lg">
          <slot name="content">{{ text }}</slot>
        </div>
      </slot>
    </div>
  </Teleport>
</template>
