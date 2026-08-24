# Cloudflare Notes PWA

A small local-first Markdown notes application. IndexedDB is the browser's working store, R2 is authoritative, and D1 is a disposable synchronization index.

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
```

The smoke test expects the local Worker to be running.

## Cloudflare deployment

Create an R2 bucket and D1 database named `note-pwa`, then replace the placeholder D1 ID in `wrangler.jsonc` with the ID returned by Cloudflare. The R2 bucket name can also be changed there if needed.

Build and deploy with:

```sh
pnpm deploy
```

Protect the deployed hostname with Cloudflare Access before storing personal notes. Local Wrangler development uses isolated local R2 and D1 data by default.
