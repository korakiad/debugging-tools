# debugging-tools

Claude Code skill system for collaborative E2E test debugging. Ships two skills plus a web GUI:

- **playwright-cli** — browser automation via Chrome DevTools Protocol (snapshots, eval, video, tracing)
- **walkthrough** — interactive debug agent that pauses failing Mocha + WebDriverIO tests, inspects the live app via CDP, asks QA to triage, and fixes selectors/code in place
- **debug-gui** (`packages/debug-gui/`) — web GUI that wraps walkthrough sessions for non-technical QA

## Who this is for

- **QA engineers** debugging flaky or broken E2E tests → use debug-gui. See [packages/debug-gui/README.md](packages/debug-gui/README.md).
- **Developers** contributing to the tools or skills → follow the dev setup below.

## Install & use (for QA / consumers)

Use this path if you want to install `@debug-tools/ui` and debug your own E2E suite — you don't need to clone or build this repo.

### Prerequisites

- Node ≥ 18
- Chrome (or any Chromium-based browser) installed for your tests to drive
- GitHub Copilot CLI authenticated (`gh auth login` + active Copilot subscription) — the agent session needs it
- Your test project uses **Mocha + WebDriverIO standalone** (`remote()` mode, not the wdio testrunner)
- Page objects use **getter methods** that return selector strings, so a fix takes effect on the next retry

### 1. Install the global CLI

The package isn't published to a public registry yet — install from the bundled tarball.

**Windows** (use bun, not npm — npm global shims on Windows fail under Claude Code's spawn):
```bash
bun install -g ./debug-tools-ui-<version>.tgz
```

**macOS / Linux**:
```bash
npm install -g ./debug-tools-ui-<version>.tgz
```

This installs two bins on your `PATH`: `debug-gui` and `debug-gui-setup-browser`.

### 2. One-time browser setup

The GUI window runs in a pure Chromium binary (downloaded to `~/.cache/puppeteer/`) hard-linked to `dgui-ui.exe` so its process name doesn't match team `chrome.exe` / `msedge.exe` kill filters mid-session. Run once after install:

```bash
debug-gui-setup-browser
```

Downloads ~150MB. Override the cache location with `PUPPETEER_CACHE_DIR=/some/path` (set the same value before launching `debug-gui` later). Skip this step and the GUI falls back to system Chrome/Edge — works fine until your test cleanup kills it.

### 3. Run it from your test project

**The rule: `cd` into YOUR test project first.** The GUI reads mocharc and discovers specs relative to `process.cwd()`.

```bash
cd ~/my-qa-project    # your test project, NOT this repo
debug-gui
```

The browser opens at `http://localhost:5555`. Pick a spec from the sidebar → Run → triage failures as they surface.

### Configuration

- **Custom mocha command** — anything before the spec is forwarded verbatim:
  ```bash
  debug-gui ./bin/mocha --timeout 30000
  # → spawns: ./bin/mocha --timeout 30000 <selected-spec>
  ```
- **Port override** — `PORT=6000 debug-gui` (default `5555`)
- **CDP port 9222 must be free** — Chrome launches with `--remote-debugging-port=9222`; close other Chrome instances using that port

For full details on retry behavior, gotchas, and troubleshooting, see [packages/debug-gui/README.md](packages/debug-gui/README.md).

## Developer prerequisites

- Node ≥ 18
- npm ≥ 11.5.1 (pinned via `packageManager` field in `package.json`)
- Git
- Chrome browser
- GitHub Copilot access (debug-gui's agent runs via `@github/copilot-sdk`)

## Developer quickstart

```bash
git clone https://github.com/korakiad/debugging-tools.git
cd debugging-tools
npm install

# Build debug-gui (server + web)
npm run build -w @debug-gui/server
npm run build -w @debug-gui/web

# Run debug-gui locally (from repo root)
node packages/debug-gui/bin/debug-gui.js

# Unit tests
npm run test -w @debug-gui/server
npm run test -w @debug-gui/web

# Smoke test (boots server, hits /api/init)
bash packages/debug-gui/test/smoke.sh
```

All commands run from the repo root — the npm workspace setup expects that.

## Other verification commands

```bash
# Walkthrough hook signaling (pause/continue plumbing)
bash test/walkthrough-hook-test/verify-hook.sh

# WDIO E2E tests against saucedemo.com (3 intentionally wrong selectors)
npx mocha test/walkthrough-e2e-wdio/login.spec.js \
  --require test/walkthrough-e2e-wdio/wdio-setup.js --timeout 30000

# Full WDIO walkthrough verification (automated pause/continue)
bash test/walkthrough-e2e-wdio/verify-wdio.sh
```

## Architecture

See [CLAUDE.md](CLAUDE.md) for a detailed overview of the two walkthrough contexts (standalone skill vs bundled debug-gui), the HTTP IPC endpoints, the session flow, and project conventions.

## Repository layout

```
.claude/skills/              # playwright-cli, walkthrough, identify-element
packages/debug-gui/          # web GUI (server + web workspaces)
test/                        # walkthrough hook + WDIO E2E fixtures
docs/plans/                  # design + implementation plans
```
