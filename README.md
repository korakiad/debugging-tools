# debugging-tools

Claude Code skill system for collaborative E2E test debugging. Ships two skills plus a web GUI:

- **playwright-cli** — browser automation via Chrome DevTools Protocol (snapshots, eval, video, tracing)
- **walkthrough** — interactive debug agent that pauses failing Mocha + WebDriverIO tests, inspects the live app via CDP, asks QA to triage, and fixes selectors/code in place
- **debug-gui** (`packages/debug-gui/`) — web GUI that wraps walkthrough sessions for non-technical QA

## Who this is for

- **QA engineers** debugging flaky or broken E2E tests → use debug-gui. See [packages/debug-gui/README.md](packages/debug-gui/README.md).
- **Developers** contributing to the tools or skills → follow the dev setup below.

## Prerequisites

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
