# Cloudflare Notes PWA — Build Contract

## Goal

Build a small, reliable, local-first Progressive Web App for one user (or a few users) to create, edit, organize, search, attach resources to, synchronize, and export personal notes across devices.

## Functional requirements

- A user can create, read, update, and delete notes, including title, content, tags, timestamps, and revision.
- A note can have separate binary resources such as images, PDFs, and audio files.
- Edits appear immediately and remain usable offline. The browser saves locally first and synchronizes changes in the background when connected.
- Multiple devices can synchronize incrementally. Concurrent changes to the same note must be detected and reported as conflicts; newer remote content must never be silently overwritten.
- Deleted notes must synchronize as deletions, including to devices that were offline when the deletion occurred.
- A user can search notes without requiring dedicated search infrastructure.
- The app can export all notes and their resources in a portable form that can restore the complete user data without any database-specific state.
- Deployment should support personal or few-user access, preferably protected by Cloudflare Access.

## Architecture decisions

```text
Browser PWA                         Cloudflare
Editor → IndexedDB → Worker API → R2 (authoritative notes and resources)
                         └────────→ D1 (derived indexes and sync journal)
```

- **Vue 3** provides the frontend application. **Workers + Static Assets** serve the built PWA and provide the API.
- **IndexedDB** holds the browser's local working copy and pending changes. The service worker caches application assets; authenticated API responses are not treated as generally cacheable content.
- **R2 is authoritative storage.** Store each active note as `notes/<note-id>/note.md`, with human-readable Markdown content and essential metadata in front matter. Store attachments separately as `notes/<note-id>/resources/<name>`; do not embed binary data in the note file.
- **D1 is derived, disposable state.** It may hold note metadata, a monotonic change journal, and optional search/tag/backlink indexes. It must contain no information required to recover notes, resources, or deletions. Schema changes rebuild D1 from R2 instead of migrating derived records in place.
- **Synchronization** uses a D1 sequence journal (for example, `GET /api/sync?after=<sequence>`) to discover incremental puts and deletes. Clients then fetch changed authoritative objects from R2.
- **Optimistic concurrency** uses a note revision and a client-provided base revision. A revision mismatch produces a conflict rather than an implicit last-write-wins update.
- **Deletion** writes `notes/<note-id>/deleted.json` as an R2-backed tombstone. When both files temporarily exist, the tombstone takes precedence over `note.md`. Tombstones may only be cleaned up after an explicit retention/synchronization policy is defined.
- **Write order favors recovery:** write R2 first, then update D1's index and journal. If D1 is stale or unavailable after an R2 write, reconcile or rebuild it by scanning R2.
- **Search** initially runs from local IndexedDB and/or a derived D1 index. No dedicated search product is required.
- **Portability** is a first-class requirement: `GET /api/export` should produce an archive of notes, resources, tombstones as needed, and simple export metadata.

## Data invariants

1. R2 alone can reconstruct the complete user-visible note state.
2. Dropping and rebuilding D1 cannot lose user data.
3. Editing never waits for a network round trip.
4. A note owns, or explicitly references, every resource it requires; no attachment metadata exists only in D1.
5. Synchronization does not silently destroy concurrent edits.
6. A complete export is independent of Cloudflare database schema.

## Scope and constraints

- Target scale is one or a few users, possibly using several devices; no meaningful scaling requirement is assumed.
- Keep operating cost low, ideally within Cloudflare's included allowances. Cost is secondary to data safety, offline use, recovery, portability, and simplicity.
- Use R2 Standard storage for active note data and normally accessed resources. Consider lifecycle transitions for old, large attachments only when there is a demonstrated need.
- Enforce application-level upload/storage limits if predictable spending is required.

## Explicitly deferred

- CRDT-based editing.
- Global content-addressed attachment storage, deduplication, and its garbage collection.
- Durable Objects, Queues, KV as primary note storage, and dedicated search services.
- Detailed front-matter and API schemas, conflict-resolution UI, tombstone retention policy, D1 rebuild mechanics, and reconciliation mechanics.
