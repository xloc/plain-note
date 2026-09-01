import type { NoteResource } from '../../../shared/note'

export function mergeResources(base: NoteResource[], remote: NoteResource[], local: NoteResource[]) {
  const baseById = new Map(base.map((resource) => [resource.id, resource]))
  const remoteById = new Map(remote.map((resource) => [resource.id, resource]))
  const localById = new Map(local.map((resource) => [resource.id, resource]))
  const ids = new Set([...baseById.keys(), ...remoteById.keys(), ...localById.keys()])
  const merged: NoteResource[] = []

  for (const id of ids) {
    const baseResource = baseById.get(id)
    const remoteResource = remoteById.get(id)
    const localResource = localById.get(id)
    const resource = sameResource(remoteResource, baseResource)
      ? localResource
      : sameResource(localResource, baseResource)
        ? remoteResource
        : (localResource ?? remoteResource)
    if (resource) merged.push({ ...resource })
  }
  return merged
}

function sameResource(left?: NoteResource, right?: NoteResource) {
  return (
    left?.id === right?.id &&
    left?.name === right?.name &&
    left?.mime === right?.mime &&
    left?.size === right?.size &&
    left?.createdAt === right?.createdAt
  )
}
