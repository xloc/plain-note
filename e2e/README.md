# End-to-end tests

These Playwright tests exercise the app's user-visible workflows in real Chromium browsers against an isolated
local Worker and its persisted storage. Desktop and mobile use separate workflows where their navigation differs.
The spec files are the source of truth for the scenarios currently covered.

## Setup

Install the project dependencies, then install Playwright's Chromium browser once:

```sh
pnpm exec playwright install chromium
```

The test command starts the local Worker and client automatically. The Worker uses dedicated `.wrangler/e2e`
storage, which is cleared before each desktop or mobile run. Tests therefore do not read or modify normal local
development data.

## Run tests

```sh
pnpm e2e                 # desktop followed by mobile
pnpm e2e -- desktop      # desktop only
pnpm e2e -- mobile       # mobile only
```

Desktop uses a 1280 × 720 viewport. Mobile emulates a Pixel 7 and runs its own workflow rather than reusing
desktop interactions.

Failure screenshots, traces, and videos are written beneath `test-results/`. Playwright's HTML report is written
to `playwright-report/`. Both directories are ignored by Git.

## Record demo videos

Add `--demo` to slow down interactions and record the complete workflow:

```sh
pnpm e2e -- desktop --demo
pnpm e2e -- mobile --demo
pnpm e2e -- all --demo
```

Demo conversion requires `ffmpeg`. On macOS it can be installed with `brew install ffmpeg`. The command converts
Playwright's WebM recording to H.264 with a Mac-compatible pixel format and writes stable output files:

- `test-results/demo-desktop.mp4`
- `test-results/demo-mobile.mp4`

The generated MP4 files are intended both for reviewing the workflow and for use as product demo videos.
