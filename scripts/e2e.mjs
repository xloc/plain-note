import { readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const playwright = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
)
const usage = `Usage: pnpm e2e -- [desktop|mobile|all] [--demo]

Examples:
  pnpm e2e
  pnpm e2e -- mobile
  pnpm e2e -- desktop --demo
  pnpm e2e -- all --demo`

const arguments_ = process.argv.slice(2)
if (arguments_.includes('--help')) {
  console.log(usage)
  process.exit()
}

const unknownOptions = arguments_.filter((argument) => argument.startsWith('-') && argument !== '--demo')
const layouts = arguments_.filter((argument) => !argument.startsWith('-'))
if (unknownOptions.length || layouts.length > 1 || (layouts[0] && !['desktop', 'mobile', 'all'].includes(layouts[0]))) {
  console.error(usage)
  process.exit(1)
}

const selectedLayout = layouts[0] ?? 'all'
const selectedLayouts = selectedLayout === 'all' ? ['desktop', 'mobile'] : [selectedLayout]
const demo = arguments_.includes('--demo')

function run(command, arguments_, environment = process.env) {
  const result = spawnSync(command, arguments_, { cwd: root, env: environment, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function findVideos(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) return findVideos(filename)
    return entry.name === 'video.webm' ? [filename] : []
  })
}

function convertVideo(layout) {
  const sourceDirectory = path.join(root, 'test-results', layout)
  const output = path.join(root, 'test-results', `demo-${layout}.mp4`)
  const source = findVideos(sourceDirectory).sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0]
  if (!source) throw new Error(`No Playwright video found in ${sourceDirectory}`)

  run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-y',
    '-i',
    source,
    '-an',
    '-c:v',
    'libx264',
    '-crf',
    '20',
    '-preset',
    'medium',
    '-vf',
    'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ])
  console.log(`Mac-compatible demo video: ${output}`)
}

for (const layout of selectedLayouts) {
  console.log(`\nRunning ${layout} E2E workflow${demo ? ' in demo mode' : ''}...`)
  const environment = { ...process.env }
  if (layout === 'mobile') environment.PLAYWRIGHT_MOBILE = '1'
  else delete environment.PLAYWRIGHT_MOBILE
  if (demo) environment.PLAYWRIGHT_DEMO = '1'
  else delete environment.PLAYWRIGHT_DEMO

  run(playwright, ['test'], environment)
  if (demo) convertVideo(layout)
}
