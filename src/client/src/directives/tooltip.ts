import { h, render, type Directive } from 'vue'
import Tooltip from '../components/Tooltip.vue'

const containers = new WeakMap<Element, HTMLDivElement>()

function mountTooltip(element: Element, text: string) {
  render(h(Tooltip, { anchor: element, text }), containers.get(element)!)
}

export const tooltip: Directive<Element, string> = {
  mounted(element, binding) {
    const container = document.createElement('div')
    document.body.append(container)
    containers.set(element, container)
    mountTooltip(element, binding.value)
  },
  updated(element, binding) {
    if (binding.value !== binding.oldValue) mountTooltip(element, binding.value)
  },
  unmounted(element) {
    const container = containers.get(element)
    if (!container) return
    render(null, container)
    container.remove()
    containers.delete(element)
  },
}
