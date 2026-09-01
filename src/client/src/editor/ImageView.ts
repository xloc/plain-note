import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { createApp, reactive } from 'vue'
import type { NoteResource } from '../../../shared/note'
import ImageNode, { type ImageNodeState } from '../components/ImageNode.vue'
import { imageResourceId } from './markdown'

export type ImageViewOptions = {
  resource: (id: string) => NoteResource | undefined
  progress: (id: string) => number | undefined
  load: (resource: NoteResource) => Promise<Blob>
  download: (resource: NoteResource) => void
  removeResource: (id: string) => void
  editable: () => boolean
  destroy: (view: ImageView) => void
}

export class ImageView implements NodeView {
  dom = document.createElement('div')
  private state: ImageNodeState
  private objectUrl?: string
  private app
  private destroyed = false
  private loading?: string

  constructor(
    private node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private options: ImageViewOptions,
  ) {
    this.dom.contentEditable = 'false'
    this.dom.className = 'w-full'
    this.state = reactive({
      src: node.attrs.src,
      alt: node.attrs.alt,
      title: node.attrs.title,
      width: node.attrs.width,
      selected: false,
      editable: options.editable(),
    })
    this.app = createApp(ImageNode, {
      state: this.state,
      onDownload: () => this.download(),
      onRemove: () => this.remove(),
      onResize: (width: number | null) => this.resize(width),
    })
    this.app.mount(this.dom)
    this.refresh()
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false
    if (node.attrs.src !== this.node.attrs.src) this.resetSource()
    this.node = node
    Object.assign(this.state, {
      src: node.attrs.src,
      alt: node.attrs.alt,
      title: node.attrs.title,
      width: node.attrs.width,
    })
    this.refresh()
    return true
  }

  refresh() {
    this.state.editable = this.options.editable()
    const id = imageResourceId(this.node.attrs.src)
    if (!id) {
      this.state.resource = undefined
      this.state.progress = undefined
      this.state.url = this.node.attrs.src
      this.state.unavailable = false
      return
    }

    const resource = this.options.resource(id)
    this.state.resource = resource
    this.state.progress = this.options.progress(id)
    if (!resource) {
      this.state.url = undefined
      this.state.unavailable = true
      return
    }
    if (!this.objectUrl && this.loading !== resource.id) void this.load(resource)
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
    this.destroyed = true
    this.resetSource()
    this.app.unmount()
    this.options.destroy(this)
  }

  private resetSource() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = undefined
    this.loading = undefined
    this.state.url = undefined
    this.state.unavailable = false
  }

  private async load(resource: NoteResource) {
    this.loading = resource.id
    try {
      const blob = await this.options.load(resource)
      if (this.destroyed || resource.id !== imageResourceId(this.node.attrs.src)) return
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = URL.createObjectURL(blob)
      this.state.url = this.objectUrl
      this.state.unavailable = false
    } catch {
      if (!this.destroyed) this.state.unavailable = true
    } finally {
      if (this.loading === resource.id) this.loading = undefined
    }
  }

  private download() {
    if (this.state.resource) this.options.download(this.state.resource)
  }

  private remove() {
    const position = this.getPos()
    if (position === undefined) return
    const id = imageResourceId(this.node.attrs.src)
    this.view.dispatch(this.view.state.tr.delete(position, position + this.node.nodeSize))
    if (id) this.options.removeResource(id)
    this.view.focus()
  }

  private resize(width: number | null) {
    const position = this.getPos()
    if (position === undefined) return
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(position, undefined, {
        ...this.node.attrs,
        width: width === null ? null : Math.min(1, Math.max(0.1, width)),
      }),
    )
  }
}
