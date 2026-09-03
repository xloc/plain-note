import { Fragment, Slice } from 'prosemirror-model'
import { GapCursor } from 'prosemirror-gapcursor'
import { NodeSelection, Selection, type Transaction } from 'prosemirror-state'

type Transfer = Pick<DataTransfer, 'files' | 'items' | 'types'>
export type FileInsertionPoint = { position: number; gap: boolean }

export function containsFiles(transfer: Transfer | null) {
  if (!transfer) return false
  return (
    transfer.files.length > 0 ||
    Array.from(transfer.types).includes('Files') ||
    Array.from(transfer.items).some((item) => item.kind === 'file')
  )
}

export function transferredFiles(transfer: Transfer | null) {
  return Array.from(transfer?.files ?? [])
}

export function fileInsertionPoint(selection: Selection): FileInsertionPoint {
  return {
    position: selection instanceof NodeSelection ? selection.to : selection.from,
    gap: selection instanceof NodeSelection || selection instanceof GapCursor,
  }
}

export function insertTransferredContent(transaction: Transaction, insertion: FileInsertionPoint, content: Fragment) {
  const position = Math.min(insertion.position, transaction.doc.content.size)
  const resolved = transaction.doc.resolve(position)
  transaction
    .setSelection(insertion.gap ? new GapCursor(resolved) : Selection.near(resolved))
    .replaceSelection(new Slice(content, 0, 0))
  if (transaction.selection instanceof NodeSelection) {
    transaction.setSelection(new GapCursor(transaction.doc.resolve(transaction.mapping.map(position, 1))))
  }
  return transaction
}
