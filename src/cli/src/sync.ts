import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Note, NoteRecord } from '@plain-note/shared/note'
import { mergeMarkdown } from '@plain-note/shared/mergeMarkdown'
import { mergeTags } from '@plain-note/shared/mergeTags'
import { mergeResources } from '@plain-note/shared/mergeResources'
import { ApiError, type NoteApi } from './api.ts'
import { atomicWrite, pending, regularPath, type LocalNote, type Workspace } from './workspace.ts'

export async function sync(workspace: Workspace, api: NoteApi) {
  const state = workspace.state
  const result = { uploaded: 0, downloaded: 0, deleted: 0 }

  async function downloadResources(note: Note) {
    const downloads = new Map<string, Uint8Array>()
    await regularPath(workspace.noteDirectory(note.id), true)
    await regularPath(join(workspace.noteDirectory(note.id), 'resources'), true)
    for (const resource of note.resources) {
      const path = workspace.resourcePath(note.id, resource.id)
      const exists = await regularPath(path)
      if (!exists || !state.notes[note.id]?.resourceHashes[resource.id]) {
        downloads.set(resource.id, await api.resource(note.id, resource))
      }
    }
    return downloads
  }

  async function writeResources(note: Note, downloads: Map<string, Uint8Array>) {
    const directory = join(workspace.noteDirectory(note.id), 'resources')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const ids = new Set(note.resources.map((resource) => resource.id))
    for (const [id, bytes] of downloads) {
      if (ids.has(id)) {
        await atomicWrite(workspace.resourcePath(note.id, id), bytes, 0o444)
        state.notes[note.id]!.resourceHashes[id] = hash(bytes)
      }
    }
    for (const id of ids) await chmod(workspace.resourcePath(note.id, id), 0o444)
    for (const name of await readdir(directory)) {
      if (/^[A-Za-z0-9_-]+$/.test(name) && !ids.has(name)) {
        await rm(workspace.resourcePath(note.id, name), { force: true })
      }
    }
    for (const id of Object.keys(state.notes[note.id]!.resourceHashes)) {
      if (!ids.has(id)) delete state.notes[note.id]!.resourceHashes[id]
    }
  }

  async function restoreResources(local: LocalNote) {
    for (const resource of local.note.resources) {
      try {
        await api.resource(local.note.id, resource)
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error
        const path = workspace.resourcePath(local.note.id, resource.id)
        await regularPath(path)
        const bytes = await readFile(path)
        // Restoring a deleted note may also require restoring expired cloud bytes. Only resend the
        // exact downloaded attachment; changed local attachments are never accepted as edits.
        if (hash(bytes) !== local.resourceHashes[resource.id]) {
          throw new Error(`Cannot restore modified attachment: ${path}`)
        }
        await api.restoreResource(local.note.id, resource, bytes)
      }
    }
  }

  async function receive(remote: NoteRecord) {
    const id = remote.id
    // Download first, without touching the note folder. The user may edit or delete it while waiting.
    const downloads = 'deleted' in remote ? new Map<string, Uint8Array>() : await downloadResources(remote)
    await workspace.scan(id)
    let local = state.notes[id]
    if ('deleted' in remote && !local) return
    const observed = await workspace.content(id)
    let write = false
    let remove = false

    if (!local && !('deleted' in remote)) {
      if (observed !== null && observed !== remote.content) {
        throw new Error(`${id} contains an untracked note. Move that folder aside before syncing.`)
      }
      local = { note: structuredClone(remote), deleted: false, base: structuredClone(remote), resourceHashes: {} }
      state.notes[id] = local
      write = true
      result.downloaded++
    } else if (local) {
      if (local.note.revision === remote.revision) {
        local.base = structuredClone(remote)
        remove = 'deleted' in remote
      } else if (!pending(local)) {
        if ('deleted' in remote) remove = true
        else {
          local.note = structuredClone(remote)
          local.base = structuredClone(remote)
          local.deleted = false
          write = true
          result.downloaded++
        }
      } else if (local.base?.revision !== remote.revision) {
        if (!local.base) throw new Error(`Note ID collision: ${id}`)
        if ('deleted' in remote) {
          if (local.deleted) remove = true
          else {
            local.base = structuredClone(remote)
            revise(local, remote.updatedAt)
          }
        } else if (local.deleted) {
          // A concurrent remote edit wins over a local deletion, matching the browser.
          local.note = structuredClone(remote)
          local.base = structuredClone(remote)
          local.deleted = false
          write = true
        } else {
          const base = 'deleted' in local.base ? null : local.base
          local.note = {
            ...local.note,
            content: mergeMarkdown(base?.content ?? '', remote.content, local.note.content),
            tags: mergeTags(base?.tags ?? [], remote.tags, local.note.tags),
            resources: mergeResources(base?.resources ?? [], remote.resources, local.note.resources),
          }
          local.base = structuredClone(remote)
          revise(local, remote.updatedAt)
          write = true
        }
      }
    }

    if (write || remove) {
      if ((await workspace.content(id)) !== observed) {
        throw new Error(`${id}/note.md changed while synchronizing. Run sync again.`)
      }
      if (remove) {
        await rm(workspace.noteDirectory(id), { recursive: true, force: true })
        delete state.notes[id]
        result.deleted++
      } else if (local) {
        await workspace.writeNote(local.note)
      }
    }
    if (local && !remove && !local.deleted) await writeResources(local.note, downloads)
    await workspace.save()
  }

  async function push() {
    for (const id of Object.keys(state.notes)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await workspace.scan(id)
        const local = state.notes[id]
        await workspace.save()
        if (!local || !pending(local)) break
        const sent = structuredClone(local.note)
        try {
          let stored: NoteRecord
          if (local.deleted) {
            if (!local.base) break
            stored = await api.delete(id, {
              baseRevision: local.base.revision,
              revision: sent.revision,
              updatedAt: sent.updatedAt,
            })
            result.deleted++
          } else {
            if (!local.base || 'deleted' in local.base) await restoreResources(local)
            try {
              stored = await api.put(sent, local.base?.revision ?? null)
            } catch (error) {
              if (!(error instanceof ApiError) || error.status !== 404 || !local.base) throw error
              await restoreResources(local)
              stored = await api.put(sent, null)
            }
            result.uploaded++
          }
          local.base = structuredClone(stored)
          // Re-read after the network request so an editor save during upload remains pending.
          await workspace.scan(id)
          if ('deleted' in stored && local.deleted && !pending(local)) delete state.notes[id]
          await workspace.save()
        } catch (error) {
          if (error instanceof ApiError && error.status === 409 && error.current) {
            await receive(error.current)
          } else if (error instanceof ApiError && error.status === 404 && local.deleted) {
            // Confirm that the user has not restored the folder while the request was in flight.
            await workspace.scan(id)
            if (local.deleted) delete state.notes[id]
            else local.base = null
            await workspace.save()
          } else throw error
        }
      }
    }
  }

  // Persist every discovered edit before network work, including deletions of never-uploaded notes.
  for (const id of Object.keys(state.notes)) await workspace.scan(id)
  await workspace.save()
  await push()

  while (true) {
    const page = await api.changes(state.generation, state.cursor)
    for (const change of page.changes) {
      const remote: NoteRecord =
        change.operation === 'delete'
          ? { id: change.id, revision: change.revision, updatedAt: change.updatedAt, deleted: true }
          : await api.get(change.id)
      await receive(remote)
    }
    if (page.reset) {
      const ids = new Set(page.changes.map((change) => change.id))
      for (const [id, local] of Object.entries(state.notes)) {
        // An index reset is not a deletion. Missing local notes retain their identities.
        if (ids.has(id) || pending(local)) continue
        local.base = null
      }
    }
    state.generation = page.generation
    state.cursor = page.cursor
    await workspace.save()
    if (!page.reset && page.changes.length < 500) break
  }

  await push()
  // Repair locally missing attachments even when the note itself has not changed remotely.
  for (const local of Object.values(state.notes)) {
    if (!local.deleted) {
      const downloads = await downloadResources(local.note)
      await workspace.scan(local.note.id)
      if (!local.deleted && state.notes[local.note.id]) await writeResources(local.note, downloads)
    }
  }
  for (const id of Object.keys(state.notes)) await workspace.scan(id)
  await workspace.save()
  if (Object.values(state.notes).some(pending)) {
    throw new Error('Some notes changed again during synchronization. Their changes are saved; run sync again.')
  }
  return result
}

function revise(local: LocalNote, remoteTime: number) {
  local.note.revision = randomUUID()
  local.note.updatedAt = Math.max(Date.now(), local.note.updatedAt + 1, remoteTime + 1)
}

function hash(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}
