import type { Node } from 'prosemirror-model'
import {
  CellSelection,
  TableMap,
  addColumn as addTableColumn,
  addRow as addTableRow,
  moveTableColumn,
  moveTableRow,
} from 'prosemirror-tables'
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view'

export class TableView implements NodeView {
  dom = document.createElement('div')
  scroller = document.createElement('div')
  canvas = document.createElement('div')
  table = document.createElement('table')
  contentDOM = document.createElement('tbody')
  controls = document.createElement('div')
  addColumnButton = document.createElement('button')
  addRowButton = document.createElement('button')
  dropIndicator = document.createElement('div')
  columnHandles: HTMLButtonElement[] = []
  rowHandles: HTMLButtonElement[] = []
  draggedAxis: 'column' | 'row' | null = null
  draggedIndex: number | null = null
  targetIndex: number | null = null
  dragHandle: HTMLButtonElement | null = null
  pointerId: number | null = null
  resizeObserver: ResizeObserver
  animationFrame = 0

  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom.className = 'tableWrapper'
    this.scroller.className = 'table-scroll'
    this.canvas.className = 'table-canvas'
    this.table.append(this.contentDOM)
    this.canvas.append(this.table, this.controls)
    this.scroller.append(this.canvas)
    this.dom.append(this.scroller)

    this.controls.className = 'table-controls'
    this.controls.contentEditable = 'false'
    this.addColumnButton.className = 'table-control table-add-column'
    this.addColumnButton.type = 'button'
    this.addColumnButton.setAttribute('aria-label', 'Add column to the right')
    this.addColumnButton.addEventListener('mousedown', (event) => event.preventDefault())
    this.addColumnButton.addEventListener('click', () => this.addColumn())

    this.addRowButton.className = 'table-control table-add-row'
    this.addRowButton.type = 'button'
    this.addRowButton.setAttribute('aria-label', 'Add row below')
    this.addRowButton.addEventListener('mousedown', (event) => event.preventDefault())
    this.addRowButton.addEventListener('click', () => this.addRow())
    this.dropIndicator.className = 'table-drop-target'
    this.dropIndicator.hidden = true
    this.controls.append(this.addColumnButton, this.addRowButton, this.dropIndicator)

    this.resizeObserver = new ResizeObserver(() => this.layoutControls())
    this.resizeObserver.observe(this.table)
    this.rebuildHandles()
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false
    this.node = node
    const map = TableMap.get(node)
    if (map.width !== this.columnHandles.length || map.height !== this.rowHandles.length) {
      this.rebuildHandles()
    } else {
      this.scheduleLayout()
    }
    return true
  }

  stopEvent(event: Event) {
    return event.target instanceof globalThis.Node && this.controls.contains(event.target)
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return (
      this.controls.contains(mutation.target) ||
      (mutation.type === 'attributes' && mutation.target === this.dom && mutation.attributeName === 'class')
    )
  }

  destroy() {
    this.finishDrag()
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
  }

  private rebuildHandles() {
    for (const handle of [...this.columnHandles, ...this.rowHandles]) handle.remove()

    const map = TableMap.get(this.node)
    this.columnHandles = Array.from({ length: map.width }, (_, column) => this.createHandle('column', column))
    this.rowHandles = Array.from({ length: map.height }, (_, row) => this.createHandle('row', row))
    this.controls.append(...this.columnHandles, ...this.rowHandles)
    this.scheduleLayout()
  }

  private createHandle(axis: 'column' | 'row', index: number) {
    const handle = document.createElement('button')
    handle.className = `table-control table-${axis}-handle`
    handle.type = 'button'
    handle.title = `Drag to rearrange ${axis}`
    handle.setAttribute('aria-label', `Move ${axis} ${index + 1}`)

    for (let index = 0; index < 6; index++) {
      const dot = document.createElement('span')
      dot.className = 'table-handle-dot'
      handle.append(dot)
    }

    handle.addEventListener('pointerdown', (event) => this.startDrag(event, axis, index, handle))
    handle.addEventListener('pointermove', (event) => this.trackDrag(event.clientX, event.clientY))
    handle.addEventListener('pointerup', () => this.dropItem())
    handle.addEventListener('pointercancel', () => this.finishDrag())
    return handle
  }

  private scheduleLayout() {
    cancelAnimationFrame(this.animationFrame)
    this.animationFrame = requestAnimationFrame(() => this.layoutControls())
  }

  private layoutControls() {
    const tableLeft = this.table.offsetLeft
    const tableTop = this.table.offsetTop
    const cells = Array.from(this.contentDOM.rows[0]?.cells ?? [])
    this.columnHandles.forEach((handle, column) => {
      const cell = cells[column]
      handle.hidden = !cell
      if (cell) {
        handle.style.left = `${tableLeft + cell.offsetLeft}px`
        handle.style.top = `${tableTop}px`
        handle.style.width = `${cell.offsetWidth}px`
      }
    })
    Array.from(this.contentDOM.rows).forEach((row, index) => {
      const handle = this.rowHandles[index]
      handle.style.height = `${row.offsetHeight}px`
      handle.style.left = `${tableLeft}px`
      handle.style.top = `${tableTop + row.offsetTop}px`
    })
    this.addColumnButton.style.left = `${tableLeft + this.table.offsetWidth}px`
    this.addColumnButton.style.height = `${this.table.offsetHeight}px`
    this.addColumnButton.style.top = `${tableTop}px`
    this.addRowButton.style.left = `${tableLeft}px`
    this.addRowButton.style.top = `${tableTop + this.table.offsetHeight}px`
    this.addRowButton.style.width = `${this.table.offsetWidth}px`
  }

  private addColumn() {
    const position = this.getPos()
    if (position == null) return
    const map = TableMap.get(this.node)
    const transaction = addTableColumn(
      this.view.state.tr,
      {
        bottom: map.height,
        left: 0,
        map,
        right: map.width,
        table: this.node,
        tableStart: position + 1,
        top: 0,
      },
      map.width,
    )
    this.view.dispatch(transaction.scrollIntoView())
    this.view.focus()
  }

  private addRow() {
    const position = this.getPos()
    if (position == null) return
    const map = TableMap.get(this.node)
    const transaction = addTableRow(
      this.view.state.tr,
      {
        bottom: map.height,
        left: 0,
        map,
        right: map.width,
        table: this.node,
        tableStart: position + 1,
        top: 0,
      },
      map.height,
    )
    this.view.dispatch(transaction.scrollIntoView())
    this.view.focus()
  }

  private selectItem(axis: 'column' | 'row', index: number) {
    const position = this.getPos()
    if (position == null) return
    const map = TableMap.get(this.node)
    const tableStart = position + 1
    const firstCell = map.positionAt(axis === 'column' ? 0 : index, axis === 'column' ? index : 0, this.node)
    const lastCell = map.positionAt(
      axis === 'column' ? map.height - 1 : index,
      axis === 'column' ? index : map.width - 1,
      this.node,
    )
    const selection = CellSelection[axis === 'column' ? 'colSelection' : 'rowSelection'](
      this.view.state.doc.resolve(tableStart + firstCell),
      this.view.state.doc.resolve(tableStart + lastCell),
    )
    this.view.dispatch(this.view.state.tr.setSelection(selection))
  }

  private startDrag(event: PointerEvent, axis: 'column' | 'row', index: number, handle: HTMLButtonElement) {
    if (event.button !== 0) return
    event.preventDefault()
    this.draggedAxis = axis
    this.draggedIndex = index
    this.targetIndex = index
    this.dragHandle = handle
    this.pointerId = event.pointerId
    this.dom.classList.add(`dragging-${axis}`)
    handle.classList.add('dragging')
    handle.setPointerCapture(event.pointerId)
  }

  private moveItem(target: number) {
    const position = this.getPos()
    if (position == null || this.draggedAxis == null || this.draggedIndex == null) {
      return
    }

    const axis = this.draggedAxis
    const source = this.draggedIndex
    if (source === target) {
      this.selectItem(axis, source)
      this.finishDrag()
      this.view.focus()
      return
    }
    this.selectItem(axis, source)
    const move = axis === 'column' ? moveTableColumn : moveTableRow
    move({
      from: source,
      pos: position + 1,
      select: true,
      to: target,
    })(this.view.state, this.view.dispatch)
    this.finishDrag()
    this.view.focus()
  }

  private finishDrag() {
    if (this.dragHandle && this.pointerId != null && this.dragHandle.hasPointerCapture(this.pointerId)) {
      this.dragHandle.releasePointerCapture(this.pointerId)
    }

    this.dom.classList.remove('dragging-column', 'dragging-row')
    this.draggedAxis = null
    this.draggedIndex = null
    this.targetIndex = null
    this.dragHandle = null
    this.pointerId = null
    this.hideDropTarget()
    for (const handle of [...this.columnHandles, ...this.rowHandles]) handle.classList.remove('dragging')
  }

  private trackDrag(clientX: number, clientY: number) {
    if (this.draggedAxis == null) return
    this.targetIndex = this.draggedAxis === 'column' ? this.columnAt(clientX) : this.rowAt(clientY)
    this.showDropTarget(this.targetIndex)
  }

  private dropItem() {
    if (this.draggedIndex == null || this.targetIndex == null) return
    this.moveItem(this.targetIndex)
  }

  private columnAt(clientX: number) {
    const cells = Array.from(this.contentDOM.rows[0]?.cells ?? [])
    const column = cells.findIndex((cell) => clientX < cell.getBoundingClientRect().right)
    return column === -1 ? cells.length - 1 : column
  }

  private rowAt(clientY: number) {
    const rows = Array.from(this.contentDOM.rows)
    const row = rows.findIndex((row) => clientY < row.getBoundingClientRect().bottom)
    return row === -1 ? rows.length - 1 : row
  }

  private showDropTarget(index: number) {
    if (this.draggedAxis == null || this.draggedIndex == null || this.draggedIndex === index) {
      this.hideDropTarget()
      return
    }
    const item = this.draggedAxis === 'column' ? this.contentDOM.rows[0]?.cells[index] : this.contentDOM.rows[index]
    if (!item) {
      this.hideDropTarget()
      return
    }
    const boundary =
      this.draggedAxis === 'column'
        ? this.table.offsetLeft + item.offsetLeft + (this.draggedIndex < index ? item.offsetWidth : 0)
        : this.table.offsetTop + item.offsetTop + (this.draggedIndex < index ? item.offsetHeight : 0)
    this.dropIndicator.className = `table-${this.draggedAxis}-drop-target`
    this.dropIndicator.hidden = false
    this.dropIndicator.style.height = this.draggedAxis === 'column' ? `${this.table.offsetHeight}px` : ''
    this.dropIndicator.style.width = this.draggedAxis === 'row' ? `${this.table.offsetWidth}px` : ''
    this.dropIndicator.style.left =
      this.draggedAxis === 'column' ? `${boundary}px` : `${this.table.offsetLeft}px`
    this.dropIndicator.style.top = this.draggedAxis === 'row' ? `${boundary}px` : `${this.table.offsetTop}px`
  }

  private hideDropTarget() {
    this.dropIndicator.hidden = true
  }
}
