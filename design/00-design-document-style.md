# Design Documents

- **Focus on requirements and design decisions.** Explain what the system must accomplish, the chosen approach, and why. Leave schemas, algorithms, request details, and step-by-step implementation to the code.
- **Tell a coherent story.** Don't write decisions as flat sections or a sequence of questions and answers. Order sections so each establishes context for the next.
- **Use short, clear titles.** Name parts of the design, such as `Storage`, `Synchronization`, and `Cleanup`, instead of summarizing conclusions in headings.
- **Use lists for parallel items.** Present comparable requirements, cases, consequences, and deferred work as bulleted or numbered lists. Use prose for a continuous explanation.
- **Place examples after the relevant design.** Keep examples short and use them to clarify the model, not reproduce an execution trace.
- **Use hierarchy to show relationships.** Put subsections beneath the concepts they depend on.

## Good example — coherent design

````markdown
# Resource Synchronization

## Goal

Extend the local-first note model with binary files while keeping the note as the single unit of ownership and synchronization.

## User-facing behavior

- Files can be attached to a note without waiting for the network.
- Attached files remain available offline after synchronization.
- Files keep their original names for display and download.
- Removing a file updates the note and synchronizes like any other note edit.

## Storage

A note owns its resources through the resource metadata in its front matter. This list is the authoritative ownership and deletion state.

Each resource has a UUID v4 identity. The UUID forms its stable R2 key, while the original filename remains presentation metadata. This permits duplicate filenames and avoids coupling identity to names or file contents.

```text
notes/<note-id>/resources/<resource-id>
```

R2 stores the authoritative bytes and IndexedDB stores the offline copy. D1 has no resource index or journal; note synchronization already announces every resource-list change.

## API

```text
GET /api/notes/<note-id>/resources/<resource-id>
PUT /api/notes/<note-id>/resources/<resource-id>
```

Uploads are immutable and idempotent. Reusing a UUID never overwrites a different resource.

There is no resource deletion endpoint. The note resource list is the only deletion signal.

## Synchronization

The browser saves a new resource locally, uploads its bytes, and then commits the note metadata that references it. The resource remains pending until the note commit succeeds. This order prevents authoritative notes from referencing missing bytes and makes conflict retries safe.

On pull, the client uses the synchronized note metadata to download missing resources and remove local files that are no longer referenced.

Concurrent resource edits use a three-way set merge keyed by UUID. Independent additions combine, and an unrelated note edit does not resurrect a resource removed on another device. Markdown keeps its existing block-level merge.

### Cleanup

Removing a resource changes only the note metadata. After committing the note, the Worker removes resources explicitly absent from the new revision.

Other unreferenced uploads receive a 24-hour grace period. This protects a new upload from a concurrent note update occurring before its own note commit. Expired objects are cleaned up opportunistically on later note writes, without a scheduled sweep or resource-specific index.

Deleting a note applies the same cleanup with an empty resource list.

### Concurrent updates

1. **Independent uploads:** A commits `photo-a` while B uploads `photo-b` from the same note revision. B's note update conflicts, merges both UUIDs, and retries, preserving both resources.
2. **Cleanup race:** Before B commits, A's update sees `photo-b` as unreferenced. The 24-hour grace period prevents immediate deletion; if B never commits, the upload later becomes eligible for cleanup.
3. **Removal and editing:** A removes a resource while B changes unrelated content. The three-way merge keeps both A's removal and B's content instead of restoring the resource from B's stale list.

## Portability

A standalone Markdown file may describe resources but cannot contain their bytes. Import therefore discards resource references rather than creating broken attachments.

A future archive format can restore resource metadata together with the corresponding files.

## Deferred

- Resource archive export and import.
- Resource renaming.
- Content hashing, content-addressed storage, and deduplication.
- Scheduled orphan cleanup.
````

## Bad example — implementation transcript

````markdown
# Resource Synchronization

## Goal

Add note-owned binary resources to the local-first synchronization model without creating a second change journal or making D1 authoritative.

Users can attach, download, and remove files while offline. Resource metadata synchronizes as part of its owning note, and resource bytes synchronize separately between IndexedDB and R2.

## User-facing behavior

- The resource dialog lists the selected note's attachments and supports attaching multiple files.
- Attaching a file saves it to IndexedDB immediately and marks the note pending without waiting for the network.
- Selecting a resource downloads it with its original filename.
- Removing a resource updates the note's resource list. The client never sends a resource deletion request.
- Referenced resources are downloaded during synchronization and remain available offline.
- The note sync indicator also represents pending resource work.

The interface adds no resource-specific visual styling. It uses the browser's native file input and dialog controls.

## Resource identity and metadata

A resource has an immutable UUID v4 identity. Its original filename is presentation metadata, not storage identity.

```ts
type NoteResource = {
  id: string
  name: string
  mime: string
  size: number
}
```

The owning note stores this metadata in its `resources` array. R2 stores the bytes at:

```text
notes/<note-id>/resources/<resource-id>
```

Resource R2 objects use their MIME type as HTTP metadata and include custom metadata for `kind`, encoded original name, declared size, and `uploadedAt`.

## API contract

```text
GET /api/notes/<note-id>/resources/<resource-id>
PUT /api/notes/<note-id>/resources/<resource-id>
```

### Upload

`PUT` carries the raw resource bytes with these headers:

```text
Content-Type: <resource MIME type>
X-Resource-Name: <percent-encoded original filename>
X-Resource-Size: <byte count>
```

A successful response returns the normalized `NoteResource` metadata.

Uploads use an R2 `If-None-Match: *` condition. Repeating an upload with the same UUID, name, MIME type, and size is idempotent. Reusing a UUID with different metadata returns `409 resource_conflict`.

### Download

`GET` streams the R2 object with its stored content type and content length. Missing resources return `404`.

All resource API responses use `Cache-Control: no-store`.

## Local storage

IndexedDB has a `resources` object store keyed by `[noteId, id]` with a `noteId` index.

```ts
type LocalResource = NoteResource & {
  noteId: string
  blob: Blob
  syncState: 'pending' | 'synced'
}
```

The browser database version is incremented when the resource store is introduced. The upgrade rebuilds the local stores instead of migrating them.

Resetting local data clears notes, resources, and sync metadata together.

## Synchronization

### Attaching a resource

1. Generate a UUID v4 resource ID.
2. Save the file blob and metadata to IndexedDB with resource state `pending`.
3. Add the metadata to the selected note's `resources` array.
4. Give the note a new revision and mark it pending.
5. Upload pending resource blobs before sending the note update.
6. Keep uploaded resources pending until the authoritative note update succeeds.
7. Mark the resource blobs synced after the note commit.

### Pulling resources

After pulling note changes, the client reconciles IndexedDB against every active note's resource list:

- Download each referenced resource that is missing locally.
- Mark a pending local resource synced when a synchronized note authoritatively references it.
- Remove local blobs that the local note metadata no longer references.

### Removing a resource

The client removes the resource metadata from the note, gives the note a new revision, and synchronizes that note normally.

## Backend cleanup

After a successful note update, the Worker lists `notes/<note-id>/resources/` and compares the objects with the authoritative note resource list.

- IDs present in the new list remain referenced and are retained.
- IDs present in the previous note but absent from the new list are deleted immediately.
- Other unreferenced objects are deleted after a 24-hour grace period.
- Objects created before `uploadedAt` metadata existed are treated as expired.

An idempotently retried note update reruns cleanup. Deleting a note writes its tombstone first, then runs cleanup with an empty referenced list.

Cleanup is opportunistic on later writes to the same note. No scheduled sweep or resource index is introduced.

## Concurrent changes

Resource metadata uses the synchronized note base and merges as a three-way set keyed by UUID.

- If one device's resource list is unchanged from the base, the other device's changes win.
- Independent additions are combined.
- A removal is not resurrected by an unrelated Markdown edit.
- Conflicting reuse of an existing UUID is rejected.

If another device deletes the note while this device has pending edits, restoring the note marks its local resources pending so their blobs are uploaded again.

## Import and export

Markdown metadata exports include resource metadata, but a standalone Markdown file contains no resource bytes. Import therefore discards resource references.

A portable archive containing notes and resource files is deferred.

## Data invariants

1. A resource belongs to one note and has one stable UUID-backed R2 key.
2. The note resource list is the only ownership and deletion state.
3. D1 contains no data required to recover resources.
4. Attaching or removing a resource never waits for the network.
5. Resource bytes upload before note metadata references them.
6. A resource is never overwritten under an existing UUID.
7. Fresh unreferenced uploads survive long enough for conflict retries.

## Definition of done

- Resources can be attached, downloaded, removed, and used offline.
- Resource changes synchronize across devices.
- The client sends no resource deletion request.
- The Worker cleans explicit removals and expires abandoned uploads.
- Upload retries are idempotent.
- Standalone Markdown imports create no dangling references.
- Client tests, Worker tests, type-checks, and the production build pass.

## Deferred

- Resource archive export and import.
- Resource renaming.
- Content hashing and integrity verification.
- Content-addressed storage and deduplication.
- Scheduled orphan sweeps and a resource-specific D1 index.
````

## Bad example — flat decision log

````markdown
# Resource Synchronization

## Goal

Add note-owned files to the local-first synchronization model while keeping ownership, conflicts, and deletion understandable from the note itself.

## Decisions

### The note owns its resources

The note's resource list is the authoritative record of which files belong to it. Resource metadata synchronizes with the note, using the existing note revision and change journal.

There is no separate D1 resource index or resource change journal. This keeps D1 derived and disposable, and avoids coordinating two synchronization histories for one user-visible note.

### Resource identity is separate from its filename

Each resource uses a UUID v4 as its stable identity and R2 object key. The original filename remains presentation metadata used by the interface, downloads, and future exports.

This supports duplicate filenames, avoids path-encoding rules, and lets identity remain stable independently of naming. Content hashes are not identities because content-addressed storage, deduplication, and garbage collection are outside the current design.

### Resource bytes synchronize separately

Resource bytes live in R2 under their owning note and in IndexedDB for offline access. Notes contain metadata references rather than embedded binary data.

The API exposes resource upload and download endpoints:

```text
GET /api/notes/<note-id>/resources/<resource-id>
PUT /api/notes/<note-id>/resources/<resource-id>
```

Uploads are immutable and idempotent. An existing UUID is not overwritten with a different resource.

### Upload precedes the note commit

The client stores attachments locally first, uploads their bytes, and then commits the note metadata that references them. A resource remains pending locally until the note commit succeeds.

This order prevents an authoritative note from referencing bytes that were never stored and allows conflict retries to repeat uploads safely.

### Note metadata is the deletion signal

Removing a resource only changes the note's resource list. There is no client-facing resource deletion endpoint.

After committing a note, the backend compares stored resources with the authoritative list:

- Resources explicitly removed from the previous note revision can be deleted immediately.
- Other unreferenced uploads receive a 24-hour grace period.

The grace period protects a fresh upload from an unrelated concurrent note update occurring before its own note commit. Cleanup is opportunistic on later writes rather than introducing a scheduled sweep or another index.

### Resource conflicts merge by identity

Concurrent resource changes use the synchronized note base and merge as a three-way set keyed by UUID. Independent additions combine, while a removal is preserved when the other device changed only unrelated note content.

Markdown continues to use its existing block-level merge. No separate resource conflict interface is introduced.

### Standalone Markdown does not restore resources

A Markdown file can contain resource metadata but not the resource bytes. Standalone Markdown imports therefore discard resource references instead of creating broken attachments.

A future portable archive may restore resource metadata only together with the corresponding files.

## Invariants

1. A resource belongs to one note and has one stable UUID-backed key.
2. The note resource list is the only authoritative ownership and deletion state.
3. D1 contains no information required to recover resources.
4. Local attachment changes do not wait for the network.
5. Resource bytes are stored before authoritative note metadata references them.
6. Concurrent edits do not silently resurrect removals or discard independent additions.

## Deferred

- Resource archive export and import.
- Resource renaming.
- Content hashing, content-addressed storage, and deduplication.
- Scheduled orphan cleanup and a resource-specific index.
````
