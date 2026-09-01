# Resource Synchronization

## Goal

Extend the local-first note model with binary files while keeping the note as the single unit of ownership and synchronization.

## User-facing behavior

- Files can be attached to a note without waiting for the network.
- Pasted and dropped files use the same attachment flow; binary data is never embedded in Markdown.
- Attached files remain available offline after synchronization.
- Files keep their original names for display and download.
- Images render in the document flow, while other resources render as file cards.
- Removing a file updates the note and synchronizes like any other note edit.
- The resource modal manages existing files; new files are attached at the editor cursor.

## Document references

- Markdown references each resource by UUID rather than by a temporary download URL.

```markdown
[Report.pdf](resource:file-id)
![Photo](resource:image-id)
![Diagram](https://example.com/diagram.png)
![Photo](resource:image-id){width=0.7}
```

- Uploaded and remote images use the same image syntax and sizing model.
- The client keeps resource metadata only while its UUID is referenced by the Markdown document.
- `{width=0.7}` means the image occupies 70% of the document width.
  - Width is stored as a ratio rather than pixels so it remains portable across screen sizes; image height follows its aspect ratio.
  - Images normally fit within the document and 80% of the viewport height. After resizing, the chosen document width is honored instead.

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

Other unreferenced uploads receive a 24-hour grace period. This protects a new upload from a concurrent note update occurring before its own note commit. Later note writes clean up opportunistically, and a daily sweep removes expired uploads that receive no later write.

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
