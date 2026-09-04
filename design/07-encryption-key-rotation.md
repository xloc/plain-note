# Encryption Key Rotation

## Goal

Let a trusted device replace the vault recovery key without changing its local notes or adding support for multiple cloud encryption versions.

## User-facing behavior

- Rotation is an explicit action with a destructive-cloud-data warning.
- The device first completes synchronization so it holds every current note and resource.
- The app creates and stores a new recovery key on the initiating device.
- Local plaintext, UUIDs, revisions, and timestamps remain unchanged.
- Other devices stop synchronizing until they import the new key.

The user must close the app on other devices during rotation. This keeps one trusted device authoritative without adding a server lock or concurrent rotation protocol.

## Cloud rebuild

Cloud storage is a replaceable encrypted copy of the trusted device's local state. Rotation clears the existing cloud notes, resources, and derived synchronization index, then installs the new non-secret key identifier. The initiating device marks its local copy for synchronization and uploads it again under the new key.

The normal synchronization path performs the rebuild. Failed uploads remain pending and retry normally; there is no separate migration state or cloud format.

## Recovery

The old encrypted cloud copy is not retained. A rotation that cannot first complete synchronization is rejected because the device may not hold every resource.

After the cloud reset succeeds, the new key is active even if rebuilding is interrupted. The unchanged local copy is sufficient to resume synchronization.

## Invariants

1. Rotation never changes note or resource identity.
2. Rotation never changes note content, metadata, revisions, or timestamps.
3. Only one recovery key is accepted by the cloud vault.
4. The trusted device remains usable throughout the cloud rebuild.
