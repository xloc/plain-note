import type { Node, NodeType } from 'prosemirror-model'
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view'

export class DetailsView implements NodeView {
  dom = document.createElement('details')
  contentDOM = this.dom
  private type: NodeType

  constructor(
    node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.type = node.type
    this.dom.open = node.attrs.open
    this.dom.addEventListener('click', this.handleClick)
  }

  update(node: Node) {
    if (node.type !== this.type) return false
    this.dom.open = node.attrs.open
    return true
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.type === 'attributes' && mutation.target === this.dom && mutation.attributeName === 'open'
  }

  destroy() {
    this.dom.removeEventListener('click', this.handleClick)
  }

  private handleClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const summary = target?.closest('summary')
    if (summary?.parentElement !== this.dom) return

    // click triangle mark to toggle details
    // override default behavior: entire summary line is active
    event.preventDefault()
    const contentStart = this.dom.getBoundingClientRect().left + parseFloat(getComputedStyle(this.dom).paddingLeft)
    if (event.clientX < contentStart) {
      event.stopPropagation()
      const position = this.getPos()
      if (position === undefined) return
      const node = this.view.state.doc.nodeAt(position)
      if (node?.type === this.type) {
        this.view.dispatch(
          this.view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, open: !node.attrs.open }),
        )
      }
    }
  }
}
