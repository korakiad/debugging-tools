# @debug-tools/ui

Web GUI for walkthrough E2E debug sessions. Lets non-technical QA trigger a Mocha + WebDriverIO run, pauses on the first failure, shows the live DOM, and lets a Copilot agent propose + apply a fix — then auto-retries the test until it passes.

## What you get

- Sidebar lists all specs discovered from your current working directory
- Click Run → the tool `fork()`'s a bundled Mocha launcher and talks to it over a Node IPC channel (no localhost HTTP, no PID polling)
- Test fails → GUI pauses, shows failure details + stack
- Agent inspects the live browser via CDP, proposes a file edit, you approve it
- Click Continue → Mocha auto-retries the test from the top (up to 5 attempts)
- Multiple broken selectors in one `it()`? Each pause → fix → continue cycle advances through them, no re-click-Run needed

## Prerequisites

- Node ≥ 18
- Chrome (or Chromium-based browser) installed for your tests to drive
- GitHub Copilot CLI authenticated (`gh auth login` + active Copilot subscription)
- Your test project uses **Mocha + WebDriverIO standalone** (`remote()` mode, not the wdio testrunner)
- Page objects use **getter methods** returning selector strings (so a fix takes effect on the next retry)

## Install

Until this package is published to an npm registry, install from the bundled tarball.

**Windows** (use bun, not npm — npm global shims on Windows fail under Claude Code's spawn):
```bash
bun install -g ./debug-tools-ui-0.0.1.tgz
```

**macOS / Linux**:
```bash
npm install -g ./debug-tools-ui-0.0.1.tgz
```

Alternatively, run directly from a clone without installing globally:
```bash
git clone https://github.com/korakiad/debugging-tools.git
cd debugging-tools && npm install
npm run build -w @debug-gui/server && npm run build -w @debug-gui/web
# Then invoke bin with an absolute path from your test project
```

## First-time browser setup

The GUI window runs in a pure Chromium binary downloaded to `~/.cache/puppeteer/` — kept separate from your test browser. This is needed because many test cleanup hooks indiscriminately kill `chrome.exe` / `msedge.exe`, which would also nuke the GUI window mid-session. The bundled binary gets hard-linked to `dgui-ui.exe` (zero extra disk on NTFS/APFS/ext4) so its process image name doesn't match those kill filters.

Run once after install:

```bash
# From a global tarball install:
debug-gui-setup-browser

# From a clone:
npm run setup-browser
```

This downloads ~150MB. Override the cache location with `PUPPETEER_CACHE_DIR=/some/path` before running setup-browser AND before launching the GUI.

If you skip this step, the GUI falls back to system Chrome/Edge — works fine until your test setup kills it.

## Usage

**The rule: `cd` into YOUR test project first.** The GUI reads mocharc and discovers specs relative to `process.cwd()` — pointing it at the wrong directory produces an empty spec list.

```bash
cd ~/my-qa-project    # your test project, NOT the debugging-tools repo
debug-gui
```

The browser opens at `http://localhost:5555`. Select a spec from the sidebar → Run → triage failures as they surface.

### Port

Default is `5555`. Override:
```bash
PORT=6000 debug-gui
```

## How retry works

When a test fails and you approve a fix:
1. The injected `afterEach` hook sends a `paused` frame over the IPC channel and `await`s a resume promise
2. You click **Continue** in the GUI → server writes `{type:'resume'}` over the IPC channel → the worker's resume promise resolves and `afterEach` returns
3. Mocha's built-in retry (`this.retries(5)`) replays the test from the top
4. `before` hooks do **not** re-run — your WDIO `browser` session survives across retries
5. If the test still fails (maybe line#2 is also broken), it pauses again showing attempt 2/6
6. After 5 exhausted retries, the test is marked failed and the suite continues

Non-idempotent steps (cart additions, form submissions) may produce duplicate side effects on retry — this is the same limitation Playwright and Cypress have with their retry features. For debugging workflow it's acceptable; for long-term suite health, make steps idempotent where possible.

## Gotchas

- **CDP port 9222 must be free** — Chrome launches with `--remote-debugging-port=9222` so playwright-cli can attach. Close other Chrome instances using that port before running.
- **Copilot auth is required** — the agent session fails to start without an authenticated GitHub Copilot subscription.
- **Windows + npm global bin** — the npm shim (`debug-gui.cmd`) fails to spawn properly when Claude Code runs it. Install with `bun install -g` instead.
- **Spec discovery** — if no specs show in the sidebar, check that your `cwd` is correct and that `debug-gui.config.json` (if present) globs match your test layout.

## Development

See the [repo root README](../../README.md) for clone + build + test instructions, and [CLAUDE.md](../../CLAUDE.md) for architecture.
