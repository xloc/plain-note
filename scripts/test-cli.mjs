import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as encryption from '../src/shared/encryption.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'plain-note-cli-integration-'))
const cli = join(root, 'src/cli/dist/main.cjs')
const first = join(temporary, 'first')
const second = join(temporary, 'second')
await mkdir(first)
await mkdir(second)
const key = await encryption.recoveryKey.import(encryption.recoveryKey.create())
const keyFile = join(temporary, 'recovery-key.txt')
await writeFile(keyFile, key.secret, { mode: 0o600 })
const port = await availablePort()
const origin = `http://127.0.0.1:${port}`
const worker = spawn(
  join(root, 'src/worker/node_modules/.bin/wrangler'),
  [
    'dev',
    '--config',
    join(root, 'wrangler.jsonc'),
    '--persist-to',
    join(temporary, 'cloud'),
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--log-level',
    'error',
    '--show-interactive-dev-session=false',
  ],
  {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(temporary, 'wrangler.log') },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let workerOutput = ''
worker.stdout.on('data', (chunk) => {
  workerOutput += chunk
})
worker.stderr.on('data', (chunk) => {
  workerOutput += chunk
})

try {
  await ready()
  const response = await fetch(`${origin}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Integration browser' }),
  })
  assert.equal(response.status, 200)
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ')
  const headers = { Cookie: cookie, 'X-Vault-Key-Id': key.id, 'Content-Type': 'application/json' }
  for (const directory of [first, second]) {
    const auth = command(directory, ['auth', '--server', origin, '--key-file', keyFile, '--no-browser'])
    const deadline = Date.now() + 10_000
    let link
    while (!link && Date.now() < deadline) {
      link = auth.output().match(/http:\/\/127\.0\.0\.1:[0-9]+\/cli-auth\?\S+/)?.[0]
      if (auth.child.exitCode !== null) throw new Error(auth.output())
      if (!link) await delay(20)
    }
    assert.ok(link, 'CLI prints a browser authorization link')
    const authorization = Object.fromEntries(new URL(link).searchParams)
    const approved = await fetch(`${origin}/api/auth/cli/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify(authorization),
    })
    assert.equal(approved.status, 200)
    assert.equal((await auth.finished).code, 0, auth.output())
    assert.equal((await stat(join(directory, '.plain-note/config.yaml'))).mode & 0o777, 0o600)
  }

  const created = await run(first, ['new'])
  const notePath = created.stdout.trim()
  const id = dirname(notePath).split('/').at(-1)
  await writeFile(notePath, 'A\n\nB\n')
  await run(first, ['sync'])
  await run(second, ['sync'])
  const secondPath = join(second, id, 'note.md')
  assert.equal(await readFile(secondPath, 'utf8'), 'A\n\nB\n')
  await writeFile(notePath, 'Remote A\n\nB\n')
  await run(first, ['sync'])
  await writeFile(secondPath, 'A\n\nLocal B\n')
  await run(second, ['sync'])
  await run(first, ['sync'])
  assert.equal(await readFile(notePath, 'utf8'), 'Remote A\n\nLocal B')

  const cloud = await (await fetch(`${origin}/api/notes/${id}`, { headers })).json()
  assert.equal(cloud.note.content, undefined)
  assert.ok(cloud.note.encrypted)
  const note = await encryption.note.decrypt(cloud.note, key.key)
  const resource = { id: randomUUID(), name: 'example.txt', mime: 'text/plain', size: 5, createdAt: Date.now() }
  const uploaded = await fetch(`${origin}/api/notes/${id}/resources/${resource.id}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    body: await encryption.resource.encrypt(new Blob(['bytes']), id, resource.id, key.key),
  })
  assert.equal(uploaded.status, 200)
  const content = `${note.content}\n\n[example.txt](resource:${resource.id})  \r\n`
  const edited = { ...note, content, resources: [resource], revision: randomUUID(), updatedAt: Date.now() }
  const committed = await fetch(`${origin}/api/notes/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ baseRevision: note.revision, note: await encryption.note.encrypt(edited, key.key) }),
  })
  assert.equal(committed.status, 200)
  await run(first, ['sync'])
  assert.equal(await readFile(notePath, 'utf8'), content)
  const attachment = join(first, id, 'resources', resource.id)
  assert.equal(await readFile(attachment, 'utf8'), 'bytes')
  assert.equal((await stat(attachment)).mode & 0o222, 0)

  await rm(dirname(notePath), { recursive: true })
  await run(first, ['sync'])
  await run(second, ['sync'])
  await assert.rejects(stat(secondPath), { code: 'ENOENT' })
  const revoked = await fetch(`${origin}/api/auth/sessions`, { method: 'DELETE', headers })
  assert.equal(revoked.status, 200)
  const rejected = await command(first, ['sync']).finished
  assert.equal(rejected.code, 1)
  assert.match(rejected.stderr, /note auth/)
  console.log(
    'CLI integration passed: authorization, encrypted two-way sync, conflicts, attachments, deletion, revocation.',
  )
} finally {
  worker.kill('SIGTERM')
  await Promise.race([new Promise((resolve) => worker.once('exit', resolve)), delay(5_000)])
  if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL')
  await rm(temporary, { recursive: true, force: true })
}

function command(cwd, args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve({ code, stdout, stderr }))
  })
  return { child, finished, output: () => stdout + stderr }
}

async function run(cwd, args) {
  const result = await command(cwd, args).finished
  assert.equal(result.code, 0, result.stderr)
  return result
}

async function ready() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(workerOutput)
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.status === 401) return
    } catch {}
    await delay(100)
  }
  throw new Error(`Local Worker did not start: ${workerOutput}`)
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}
