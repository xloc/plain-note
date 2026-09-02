import { defineConfig, devices } from '@playwright/test'

const demo = process.env.PLAYWRIGHT_DEMO === '1'
const mobile = process.env.PLAYWRIGHT_MOBILE === '1'
const video = mobile
  ? { mode: demo ? ('on' as const) : ('retain-on-failure' as const), size: { width: 412, height: 839 } }
  : { mode: demo ? ('on' as const) : ('retain-on-failure' as const), size: { width: 1280, height: 720 } }

export default defineConfig({
  testDir: './e2e',
  testMatch: mobile ? 'mobile-note-lifecycle.spec.ts' : 'note-lifecycle.spec.ts',
  outputDir: mobile ? 'test-results/mobile' : 'test-results/desktop',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: demo ? 120_000 : 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:15173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: demo ? { slowMo: 150 } : undefined,
  },
  projects: [
    {
      name: mobile ? 'mobile-chromium' : 'desktop-chromium',
      use: mobile
        ? { ...devices['Pixel 7'], video }
        : { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, video },
    },
  ],
  webServer: [
    {
      command: 'node scripts/start-e2e-worker.mjs',
      url: 'http://127.0.0.1:18787/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'node_modules/.bin/vp -C src/client dev --host 127.0.0.1 --port 15173',
      url: 'http://127.0.0.1:15173',
      env: { PLAIN_NOTE_API_ORIGIN: 'http://127.0.0.1:18787' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
