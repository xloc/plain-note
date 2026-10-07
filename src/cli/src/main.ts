#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { authenticate } from './auth.ts'
import { createApi } from './api.ts'
import { newNote } from './new.ts'
import { sync } from './sync.ts'
import { withWorkspace } from './workspace.ts'

const help = `Usage: plain-note <auth|new|sync>

All commands operate in the current directory.

  auth [--server URL] [--key-file PATH] [--no-browser]
       Sign in through a browser and save the vault recovery key.
  new  Create an empty local note and print its path.
  sync Synchronize notes once; download read-only attachments.
`

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      server: { type: 'string' },
      'key-file': { type: 'string' },
      'no-browser': { type: 'boolean' },
    },
  })
  if (values.help || positionals.length === 0) {
    console.log(help)
    return
  }
  const command = positionals[0]
  if (positionals.length !== 1 || !['auth', 'new', 'sync'].includes(command!)) throw new Error(help)
  if (command !== 'auth' && Object.keys(values).some((key) => key !== 'help')) {
    throw new Error('Only auth accepts options. All commands use the current directory.')
  }
  await withWorkspace(process.cwd(), async (workspace) => {
    if (command === 'new') {
      console.log(await newNote(workspace))
    } else if (command === 'auth') {
      await authenticate(workspace, {
        server: values.server,
        keyFile: values['key-file'],
        browser: !values['no-browser'],
      })
    } else {
      const config = await workspace.config()
      if (!config) throw new Error('Run plain-note auth in this directory first.')
      const result = await sync(workspace, await createApi(config))
      console.log(`Synced: ${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.deleted} deleted.`)
    }
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
