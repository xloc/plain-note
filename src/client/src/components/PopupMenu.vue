<script setup lang="ts">
import { EllipsisHorizontalIcon } from '@heroicons/vue/24/outline'
import { autoUpdate, flip, offset, shift, useFloating, type Placement, type VirtualElement } from '@floating-ui/vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import type { Component } from 'vue'
import { computed, ref, shallowRef, useTemplateRef } from 'vue'

export type PopupMenuItem = {
  icon?: Component
  label: string
  action: () => void
  disabled?: boolean
  destructive?: boolean
  /** Whether to show this item. The item is shown when omitted. */
  when?: boolean
}

const props = withDefaults(
  defineProps<{
    items: PopupMenuItem[]
    title?: string
    showTrigger?: boolean
  }>(),
  { showTrigger: true },
)
const trigger = useTemplateRef<HTMLElement>('trigger')
const panel = useTemplateRef<HTMLElement>('panel')
const visible = ref(false)
const point = shallowRef<VirtualElement>()
const visibleItems = computed(() => props.items.filter((item) => item.when !== false))
const reference = computed(() => point.value ?? trigger.value)
const placement = computed<Placement>(() => (point.value ? 'right-start' : 'bottom-end'))
const { floatingStyles } = useFloating(reference, panel, {
  open: visible,
  placement,
  strategy: 'fixed',
  middleware: [offset(4), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
})

function close() {
  visible.value = false
  point.value = undefined
}

function toggle() {
  point.value = undefined
  visible.value = !visible.value
}

function openAt(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const { clientX: x, clientY: y } = event
  point.value = {
    contextElement: event.currentTarget instanceof Element ? event.currentTarget : undefined,
    getBoundingClientRect: () => new DOMRect(x, y),
  }
  visible.value = true
}

function select(item: PopupMenuItem) {
  if (item.disabled) return
  item.action()
  close()
}

onClickOutside(panel, close, { ignore: [trigger], detectIframe: true })
useEventListener(document, 'keydown', (event) => {
  if (event.key === 'Escape') close()
})
useEventListener(window, 'blur', close)

defineExpose({ openAt, close })
</script>

<template>
  <button
    v-if="props.showTrigger"
    ref="trigger"
    v-tooltip="'More actions'"
    class="rounded-lg bg-stone-100 p-2 text-stone-700 hover:bg-stone-50"
    type="button"
    @click="toggle"
  >
    <EllipsisHorizontalIcon class="size-5" />
  </button>

  <Teleport to="body">
    <div
      v-if="visible"
      ref="panel"
      class="z-50 min-w-48 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg"
      :style="floatingStyles"
      @contextmenu.prevent
    >
      <strong v-if="title" class="block max-w-72 truncate border-b border-stone-200 px-3 py-2 text-sm">
        {{ title }}
      </strong>
      <button
        v-for="item in visibleItems"
        :key="item.label"
        class="flex w-full items-center gap-2 border-b border-stone-200 px-3 py-2 text-sm whitespace-nowrap last:border-b-0 disabled:opacity-50"
        :class="item.destructive ? 'text-red-500 hover:bg-red-50' : 'text-stone-700 hover:bg-stone-50'"
        type="button"
        :disabled="item.disabled"
        @click="select(item)"
      >
        <component :is="item.icon" v-if="item.icon" class="size-4" />
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>
