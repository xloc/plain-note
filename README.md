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
```

The smoke test expects the local Worker to be running.

## Cloudflare deployment

### First production deployment
1. Create an R2 bucket and D1 database named `plain-note`.
2. Replace `d1_databases.database_id` in `wrangler.jsonc`.
3. `pnpm deploy`
4. Configure Cloudflare Access (Auth):
    1. Enable zero trust
    3. Allow policy: intended email addresses or identity groups
    4. Add worker environment variables: 
        - `TEAM_DOMAIN`: like `https://throbbing-firefly-e880.cloudflareaccess.com`
        - `POLICY_AUD`: like `64bc46c...` len=64

### Later deployments
1. Replace `d1_databases.database_id` in `wrangler.jsonc`
2. `pnpm deploy`
