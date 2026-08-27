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

Create an R2 bucket and D1 database named `plain-note`, then replace the placeholder D1 ID in `wrangler.jsonc` with the ID returned by Cloudflare. The R2 bucket name can also be changed there if needed.

Build and deploy with:

```sh
pnpm deploy
```

Configure authentication after the first deployment:

1. In Cloudflare, open **Workers & Pages**, select the Worker, and go to **Settings > Domains & Routes**.
2. Enable Cloudflare Access for the deployed hostname.
3. Configure an Access policy that allows only the intended email addresses or identity groups.
4. In the Worker's dashboard environment variables, set `TEAM_DOMAIN` to `https://<team-name>.cloudflareaccess.com` and `POLICY_AUD` to the Access application's Audience (AUD) tag. Wrangler preserves these dashboard values on later deploys.
5. Redeploy, then confirm that a private browser window is sent to the Cloudflare sign-in page before the app loads.

Local Wrangler development uses isolated local R2 and D1 data and bypasses Cloudflare Access on `localhost`, `127.0.0.1`, and `[::1]`.
