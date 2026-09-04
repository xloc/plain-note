# Client-Side Encryption

## Goal

Protect cloud-stored notes and resources from disclosure through leaked R2 data, D1 data, backups, or storage credentials without changing the local-first editing model.

## User-facing behavior

- Notes and resources remain ordinary plaintext on a trusted device.
- The app requires a recovery key before opening the note interface.
- The first trusted device creates the vault and saves its recovery key outside the app.
- Other devices join the vault by importing that recovery key.
- Importing a key does not rewrite unchanged notes or alter their update times.
- Losing every copy of the recovery key makes the cloud data unrecoverable.

## Trust model

The browser is trusted with the recovery key and plaintext. Encryption protects data outside trusted browsers; it does not protect a compromised device or defend against malicious application code.

HTTPS protects the application while it travels to the browser and allows the client to use native Web Crypto. The app also supports local HTTP hosting through an audited software implementation with the same encrypted format. This fallback preserves encryption at rest, but an active network attacker could replace an HTTP-delivered application and capture its key or plaintext.

Cloudflare Access and app sessions remain responsible for controlling API access. Encryption is independent: revoking a session prevents future downloads but cannot erase a key or plaintext already held by a device.

## Vault key

One random 256-bit symmetric key protects the entire vault. The key is stored separately from note records on each trusted device and never sent to the Worker.

The recovery value is designed for reliable manual entry. It uses a short `pn1-` prefix and Base58 characters grouped in fives. Base58 avoids the visually ambiguous `0`, `O`, `I`, and `l` characters.

The Worker stores a non-secret identifier derived from the key: a SHA-256 hash, encoded for use in a request header. The first device to write a vault creates this value. Each later device sends the identifier with its requests, and the Worker rejects requests whose identifier differs. This catches a device configured with the wrong recovery key before it can write ciphertext that its owner cannot later decrypt.

Resetting synchronized local data preserves the recovery key. Replacing or exporting the key remains an explicit user action.

## Local state

IndexedDB continues to store the existing plaintext note records and resource blobs. Editing, search, conflict resolution, import, export, and offline access use those records without encryption-specific representations.

Encryption and decryption happen only at the cloud boundary. This keeps cryptographic metadata out of the editor and avoids maintaining parallel encrypted and plaintext local models.

## Cloud storage

### Notes

An active cloud note contains a small operational envelope and an encrypted private payload.

The operational envelope contains only:

- note identity;
- revision and update time;
- current resource UUIDs;
- encrypted payload.

The encrypted payload keeps the complete note in its existing format. The operational envelope deliberately exposes resource UUIDs: they are opaque identifiers, and the Worker needs them to identify resources that are no longer owned by a note. Resource names, types, sizes, and other metadata remain encrypted.

D1 continues to store only the derived synchronization index. It does not store ciphertext or user-visible note metadata.

### Resources

Resource bytes are encrypted before upload and remain at their existing UUID-backed R2 keys.

```text
notes/<note-id>/resources/<resource-id>
```

The resource UUID is the only resource metadata deliberately exposed to the Worker. It gives the resource a stable cloud identity without revealing its name, type, size, or creation time, all of which remain inside the encrypted note. R2 also observes ciphertext size and upload time.

Resource UUIDs are immutable. Repeating an upload for an already encrypted UUID keeps the first ciphertext, making synchronization retries safe.

## Synchronization

The client encrypts a complete plaintext note immediately before upload and decrypts a cloud note immediately after download. Optimistic revision checks and three-way conflict handling continue to operate on the plaintext local model.

- Importing a recovery key does not change or upload local notes.
- Conflicting user edits merge normally, and the merged note uploads later.

### Cleanup

The client uploads encrypted resource bytes before committing the note that references them. After accepting a note update, the Worker compares the previous and current clear resource UUID lists.

- A UUID removed by the accepted note update is deleted immediately.
- A UUID in the current list is retained regardless of object age.
- An unreferenced upload is protected for 24 hours after its R2 upload time.
- The daily sweep removes an expired object only when the current note does not reference it.
- Deleting a note treats its resource list as empty.

The grace period protects the interval between uploading resource bytes and committing their note. Note edits do not refresh resource objects and do not need to: a current reference always takes precedence over age.

Resource cleanup happens after saving the note. If cleanup fails, the note remains saved, the failure appears in storage status, and the daily cleanup job tries again. Storage status also compares resources used by notes with all resources stored in R2.

## Server visibility

The server deliberately sees only the operational information needed to synchronize notes and clean up unused resources:

- note and resource UUIDs;
- resource ownership by note;
- revisions, update times, and deletion state;
- request timing, authenticated sessions, upload times, and ciphertext sizes.

The server cannot read Markdown, tags, filenames, MIME types, plaintext sizes, resource creation times, or resource bytes.

## Invariants

1. Local note and resource models remain plaintext and independent of the encrypted cloud representation.
2. The vault key never reaches the Worker or cloud storage.
3. R2 plus the recovery key can reconstruct the complete user-visible state.
4. Clear resource UUIDs reveal ownership for cleanup but no resource presentation metadata.
5. A referenced resource is never removed because its object is old.
6. Importing a recovery key does not rewrite unchanged notes or change their timestamps.
7. Native and software encryption produce one compatible cloud format.

## Deferred

- QR, BLE, or other direct device-to-device recovery-key transfer.
- Password-derived keys and account-assisted recovery.
- Encrypted portable archive export and import.
