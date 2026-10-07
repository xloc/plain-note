export function mergeTags(base: string[], remote: string[], local: string[]) {
  const baseTags = new Set(base)
  const remoteTags = new Set(remote)
  const localTags = new Set(local)

  // Resolve membership independently so an unchanged side cannot undo the other's change.
  return [...new Set([...base, ...remote, ...local])].filter((tag) =>
    remoteTags.has(tag) === baseTags.has(tag) ? localTags.has(tag) : remoteTags.has(tag),
  )
}
