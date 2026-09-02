import { rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const storage = path.join(root, '.wrangler', 'e2e')
const wrangler = path.join(
  root,
  'src',
  'worker',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
)

rmSync(storage, { recursive: true, force: true })

const worker = spawn(
  wrangler,
  [
    'dev',
    '--config',
    path.join(root, 'wrangler.jsonc'),
    '--persist-to',
    storage,
    '--ip',
    '127.0.0.1',
    '--port',
    '18787',
    '--log-level',
    'warn',
    '--show-interactive-dev-session=false',
  ],
  { cwd: root, env: process.env, stdio: 'inherit' },
)

function stop(signal) {
  worker.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
worker.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
