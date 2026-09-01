import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { createApp, reactive } from 'vue'
import type { NoteResource } from '../../../shared/note'
import ResourceNode, { type ResourceNodeState } from '../components/ResourceNode.vue'

export type ResourceViewOptions = {
  resource: (id: string) => NoteResource | undefined
  progress: (id: string) => number | undefined
  download: (resource: NoteResource) => void
  remove: (id: string) => void
  editable: () => boolean
  destroy: (view: ResourceView) => void
}

export class ResourceView implements NodeView {
  dom = document.createElement('div')
  private state: ResourceNodeState
  private app

  constructor(
    private node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private options: ResourceViewOptions,
  ) {
    this.dom.contentEditable = 'false'
    this.state = reactive({
      id: node.attrs.id,
      name: node.attrs.name,
      selected: false,
      editable: options.editable(),
    })
    this.app = createApp(ResourceNode, {
      state: this.state,
      onDownload: () => this.download(),
      onRemove: () => this.remove(),
    })
    this.app.mount(this.dom)
    this.refresh()
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    Object.assign(this.state, {
      id: node.attrs.id,
      name: node.attrs.name,
    })
    this.refresh()
    return true
  }

  refresh() {
    const resource = this.options.resource(this.node.attrs.id)
    this.state.resource = resource
    this.state.progress = this.options.progress(this.node.attrs.id)
    this.state.editable = this.options.editable()
  }

  selectNode() {
    this.state.selected = true
  }

  deselectNode() {
    this.state.selected = false
  }

  stopEvent(event: Event) {
    return event.target instanceof Element && Boolean(event.target.closest('button, input'))
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.app.unmount()
    this.options.destroy(this)
  }

  private download() {
    if (this.state.resource) this.options.download(this.state.resource)
  }

  private remove() {
    const position = this.getPos()
    if (position === undefined) return
    this.view.dispatch(this.view.state.tr.delete(position, position + this.node.nodeSize))
    this.options.remove(this.node.attrs.id)
    this.view.focus()
  }
}
