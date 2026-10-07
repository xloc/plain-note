# plain-note

A small local-first Markdown notes PWA on Cloudflare. IndexedDB is the browser's working store, R2 is authoritative, and D1 is a disposable synchronization index.

## Local development

Install dependencies from the repository root:

```sh
pnpm install
```

Run the Worker and Vue client in separate terminals:

```sh
pnpm dev:worker
pnpm dev:client
```

The client runs on `http://localhost:5173` and proxies API requests to the Worker on `http://localhost:8787`.

Useful checks:

```sh
pnpm build
pnpm typecheck
pnpm smoke
pnpm e2e
```

The smoke test expects the local Worker to be running.

End-to-end test and demo instructions are in [e2e/README.md](e2e/README.md).

## Command-line client

The Node.js CLI supports `auth`, `new`, and `sync`. All three commands operate in the current directory.

Build it with `pnpm build:cli`, then run `node /absolute/path/to/note-pwa/src/cli/dist/main.cjs` from your notes
directory. For convenience, define `alias plain-note='node /absolute/path/to/note-pwa/src/cli/dist/main.cjs'`.
The built file is standalone and can also be installed on your PATH as `plain-note`.

```sh
plain-note auth --server https://your-notes.example.com
plain-note new
plain-note sync
```

`auth` opens a browser approval page and then asks for the existing vault recovery key. For SSH or unattended
terminal input, use `--no-browser --key-file /path/to/recovery-key.txt` and open the printed URL on another device.
The browser must be signed in. CLI sessions have the same 30-day expiry and revocation controls as browser sessions.
The Worker and browser changes in this repository must be deployed before CLI authorization is available.

`new` works offline, creates a UUID-named note folder, and prints the path to its empty `note.md`.
Edit that file with any text editor. Delete the whole note folder to delete the note on the next sync.
Keep folder names unchanged; use `new` to create notes rather than copying or renaming folders.

`sync` performs one two-way synchronization pass. Markdown is transferred without adding front matter,
rewriting `resource:` links, or reformatting. Concurrent edits use the browser's three-way merge rules;
overlapping blocks retain both versions between horizontal dividers. An edit wins over a concurrent deletion.

```text
notes-directory/
  .plain-note/
    config.yaml
    state.json
  <note-uuid>/
    note.md
    resources/
      <resource-uuid>
```

Attachments are decrypted downloads with read-only permissions. Manage attachments through the browser;
the CLI never uploads local attachment changes. When restoring a deleted note, it can restore missing cloud
attachments only after checking their bytes against the saved download hashes. Only tracked note folders are synchronized.

`.plain-note/config.yaml` stores the server, session credentials, and recovery key with owner-only permissions.
`.plain-note/state.json` stores note metadata and merge bases. The metadata directory excludes itself from Git.
Keep it with this folder: removing synchronization state loses the history needed to recognize local deletions
and merge edits. If a command is forcibly interrupted and leaves `.plain-note/lock`, remove the lock after confirming
that the command has stopped, then retry.

CLI tests run with `pnpm --filter @plain-note/cli test`. Worker authorization tests run with
`node --test src/worker/auth.test.js src/worker/cli-auth.test.js` on Node.js 24.
After `pnpm build`, `node scripts/test-cli.mjs` on Node.js 24 checks authorization and two-way sync against an isolated local
Worker using temporary storage. It exercises the approval API without controlling a browser.

## Cloudflare deployment

### First production deployment

1. Create an R2 bucket and D1 database named `plain-note`.
2. Replace `d1_databases.database_id` in `wrangler.jsonc`.
3. `pnpm deploy`
4. Configure Cloudflare Access (Auth):
   1. Enable zero trust
   2. Allow policy: intended email addresses or identity groups
   3. Protect only `/api/auth/login` and `/api/auth/session` on the app hostname. Leave the app shell and other API routes outside Access; the Worker requires an app session for those APIs.
   4. Add worker environment variables:
      - `TEAM_DOMAIN`: like `https://throbbing-firefly-e880.cloudflareaccess.com`
      - `POLICY_AUD`: like `64bc46c...` len=64

### Later deployments

1. `pnpm deploy`
2. Config conflict:
   - “Continue?”: No
   - “Update the local config?”: Yes
3. `pnpm deploy` again
4. After deployment: discard `wrangler.jsonc` changes
