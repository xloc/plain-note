# First Slice — Note Editing and Synchronization

## Goal

Deliver the smallest usable path from an offline Vue editor through IndexedDB synchronization to authoritative notes in R2.

## User-facing behavior

- The user can create, select, edit, and delete plain Markdown notes.
- Edits are saved to IndexedDB immediately and do not wait for the network.
- The app synchronizes pending changes in the background and on request.
- Changes and deletions made by another device appear through incremental synchronization.
- A concurrent edit is shown as a conflict. The user can keep the local version or accept the server version.
- The installed application shell remains available offline.

## API contract

```text
GET    /api/health
GET    /api/sync?generation=<id>&after=<sequence>
GET    /api/notes/<id>
PUT    /api/notes/<id>
DELETE /api/notes/<id>
```

`PUT` carries the complete note plus `baseRevision`. `DELETE` carries `baseRevision`, a new deletion revision, and its timestamp. A base revision mismatch returns `409` with the current authoritative note or tombstone.

The sync response contains the current D1 generation, a cursor, and changed note identifiers. A generation mismatch returns a complete index snapshot and tells the client to reset its cursor.

## Storage decisions

- A logical note has one stable R2 key: `notes/<id>/note.md`.
- An active object is Markdown with YAML front matter and `text/markdown` metadata.
- A deleted object is a JSON tombstone with `application/json` metadata at the same key. Reusing the key allows R2 ETag conditions to serialize edits, deletes, and restores.
- D1 contains only the note index, change journal, and schema/generation metadata.
- A D1 schema-version mismatch drops and rebuilds derived tables by scanning R2. There are no migration scripts.

## Definition of done

- The Vue production build and Worker type-check pass.
- Local editing survives a reload without a server.
- The Worker can create, update, delete, restore, and read an R2 note with revision checks.
- A new or rebuilt D1 database reconstructs its note index from R2.
- Authenticated API responses are marked `no-store`; the service worker never caches `/api/` requests.

## Deferred

- Attachments and export archives.
- Cloudflare Access setup and validation inside the Worker.
- Automatic conflict merging, rich Markdown editing, search, and visual styling.
