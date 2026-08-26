import { markdownParser } from './markdown.ts'

type Edit = {
  from: number
  to: number
  blocks: string[]
}

const divider = '---'

export function mergeMarkdown(base: string, server: string, device: string) {
  if (server === device)
    return server
  if (server === base)
    return device
  if (device === base)
    return server

  return mergeBlocks(markdownBlocks(base), markdownBlocks(server), markdownBlocks(device)).join('\n\n')
}

export function markdownBlocks(content: string) {
  const lines = content.split('\n')
  return markdownParser.tokenizer.parse(content, {})
    .flatMap(token => token.level === 0 && token.map
      ? [lines.slice(token.map[0], token.map[1]).join('\n').replace(/\n+$/, '')]
      : [])
}

function mergeBlocks(base: string[], server: string[], device: string[]) {
  const serverEdits = edits(base, server)
  const deviceEdits = edits(base, device)
  const merged: string[] = []
  let position = 0
  let serverIndex = 0
  let deviceIndex = 0

  while (position < base.length || serverIndex < serverEdits.length || deviceIndex < deviceEdits.length) {
    const serverEdit = serverEdits[serverIndex]
    const deviceEdit = deviceEdits[deviceIndex]
    const next = Math.min(serverEdit?.from ?? base.length, deviceEdit?.from ?? base.length, base.length)

    if (position < next) {
      merged.push(...base.slice(position, next))
      position = next
      continue
    }

    const serverHere = serverEdit?.from === position
    const deviceHere = deviceEdit?.from === position

    if (serverHere && deviceHere && sameEdit(serverEdit, deviceEdit)) {
      merged.push(...serverEdit.blocks)
      position = serverEdit.to
      serverIndex++
      deviceIndex++
      continue
    }

    const overlaps = serverHere && deviceHere
      || serverHere && deviceEdit !== undefined && deviceEdit.from < serverEdit.to
      || deviceHere && serverEdit !== undefined && serverEdit.from < deviceEdit.to

    if (overlaps) {
      let end = Math.max(serverHere ? serverEdit.to : position, deviceHere ? deviceEdit.to : position)
      let nextServer = serverIndex + (serverHere ? 1 : 0)
      let nextDevice = deviceIndex + (deviceHere ? 1 : 0)
      let extended = true

      while (extended) {
        extended = false
        const followingServer = serverEdits[nextServer]
        if (followingServer && followingServer.from < end) {
          end = Math.max(end, followingServer.to)
          nextServer++
          extended = true
        }
        const followingDevice = deviceEdits[nextDevice]
        if (followingDevice && followingDevice.from < end) {
          end = Math.max(end, followingDevice.to)
          nextDevice++
          extended = true
        }
      }

      merged.push(
        divider,
        ...applyEdits(base, position, end, serverEdits.slice(serverIndex, nextServer)),
        divider,
        ...applyEdits(base, position, end, deviceEdits.slice(deviceIndex, nextDevice)),
        divider,
      )
      position = end
      serverIndex = nextServer
      deviceIndex = nextDevice
      continue
    }

    if (serverHere) {
      merged.push(...serverEdit.blocks)
      position = serverEdit.to
      serverIndex++
      continue
    }

    if (deviceHere) {
      merged.push(...deviceEdit.blocks)
      position = deviceEdit.to
      deviceIndex++
      continue
    }

    merged.push(base[position])
    position++
  }

  return merged
}

function edits(base: string[], target: string[]) {
  const common = Array.from({ length: base.length + 1 }, () => new Uint32Array(target.length + 1))
  for (let baseIndex = base.length - 1; baseIndex >= 0; baseIndex--) {
    for (let targetIndex = target.length - 1; targetIndex >= 0; targetIndex--) {
      common[baseIndex][targetIndex] = base[baseIndex] === target[targetIndex]
        ? common[baseIndex + 1][targetIndex + 1] + 1
        : Math.max(common[baseIndex + 1][targetIndex], common[baseIndex][targetIndex + 1])
    }
  }

  const result: Edit[] = []
  let baseIndex = 0
  let targetIndex = 0
  let current: Edit | undefined

  const begin = () => current ??= { from: baseIndex, to: baseIndex, blocks: [] }
  const finish = () => {
    if (current)
      result.push(current)
    current = undefined
  }

  while (baseIndex < base.length || targetIndex < target.length) {
    if (baseIndex < base.length && targetIndex < target.length && base[baseIndex] === target[targetIndex]) {
      finish()
      baseIndex++
      targetIndex++
    }
    else if (targetIndex < target.length && (
      baseIndex === base.length
      || common[baseIndex][targetIndex + 1] > common[baseIndex + 1][targetIndex]
    )) {
      begin().blocks.push(target[targetIndex])
      targetIndex++
    }
    else {
      begin()
      baseIndex++
      current!.to = baseIndex
    }
  }
  finish()
  return result
}

function sameEdit(left: Edit, right: Edit) {
  return left.to === right.to
    && left.blocks.length === right.blocks.length
    && left.blocks.every((block, index) => block === right.blocks[index])
}

function applyEdits(base: string[], from: number, to: number, changes: Edit[]) {
  const result: string[] = []
  let position = from
  for (const change of changes) {
    result.push(...base.slice(position, change.from), ...change.blocks)
    position = change.to
  }
  result.push(...base.slice(position, to))
  return result
}
