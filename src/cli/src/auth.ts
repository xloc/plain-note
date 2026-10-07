import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { recoveryKey } from '@plain-note/shared/encryption'
import type { CliAuthorization, CliCredentials } from '@plain-note/shared/auth'
import { createApi } from './api.ts'
import type { Workspace } from './workspace.ts'

export async function authenticate(
  workspace: Workspace,
  options: { server?: string; keyFile?: string; browser: boolean },
) {
  const previous = await workspace.config()
  const server = serverOrigin(options.server ?? previous?.server ?? (await prompt('Server URL: ')))
  if (previous && previous.server !== server && Object.values(workspace.state.notes).some((note) => note.base)) {
    throw new Error('This folder is already synchronized with another server. Use a separate folder.')
  }
  const verifier = randomBytes(32).toString('base64url')
  const authorization: CliAuthorization = {
    id: randomUUID(),
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    name: `CLI · ${hostname()}`.slice(0, 100),
  }
  const url = new URL('/cli-auth', server)
  for (const [key, value] of Object.entries(authorization)) url.searchParams.set(key, value)
  console.error(`Open this URL and approve code ${authorization.challenge.slice(0, 8)}:\n${url}`)
  if (options.browser) openBrowser(url.href)
  const credentials = await waitForAuthorization(server, authorization.id, verifier)

  const secret = options.keyFile
    ? await readFile(options.keyFile, 'utf8')
    : (await prompt(previous ? 'Recovery key (Enter to reuse saved key): ' : 'Recovery key: ', true)) ||
      previous?.recoveryKey ||
      ''
  const vault = await recoveryKey.import(secret)
  const config = { server, recoveryKey: vault.secret, token: credentials.token, clientKey: credentials.clientKey }
  // A read verifies the key fingerprint without creating or replacing the cloud vault.
  await (await createApi(config)).changes(null, 0)
  await workspace.saveConfig(config)
  console.error('Authenticated. Run plain-note sync to synchronize this folder.')
}

export async function waitForAuthorization(server: string, id: string, verifier: string, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await fetch(new URL('/api/auth/cli/exchange', server), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: server },
      body: JSON.stringify({ id, verifier }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (response.status === 200) return response.json() as Promise<CliCredentials>
    if (response.status !== 202) throw new Error(`CLI authorization failed (${response.status}).`)
    await delay(2_000)
  }
  throw new Error('Authorization timed out. Run plain-note auth again.')
}

export function serverOrigin(value: string) {
  const url = new URL(value.trim())
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('Use an HTTPS server URL, or HTTP on localhost for development.')
  }
  return url.origin
}

async function prompt(question: string, secret = false) {
  if (!process.stdin.isTTY) throw new Error('Interactive input is unavailable. Supply --server and --key-file.')
  let muted = false
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stderr.write(chunk)
      callback()
    },
  })
  const terminal = createInterface({ input: process.stdin, output, terminal: true })
  try {
    const answer = terminal.question(question)
    muted = secret
    return (await answer).trim()
  } finally {
    terminal.close()
    if (secret) process.stderr.write('\n')
  }
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => console.error('Open the URL above in a browser to continue.'))
  child.unref()
}
