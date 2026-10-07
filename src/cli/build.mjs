import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const directory = new URL('./', import.meta.url)
const {
  name,
  version,
  private: isPrivate,
  bin,
  engines,
} = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'))

await build({
  absWorkingDir: fileURLToPath(directory),
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bin.note,
})

// The bundle includes every dependency, so installing it needs no workspace packages.
await writeFile(
  new URL('dist/package.json', directory),
  `${JSON.stringify({ name, version, private: isPrivate, bin: { note: basename(bin.note) }, engines }, null, 2)}\n`,
)
