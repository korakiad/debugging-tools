# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Claude Code skill system for collaborative E2E test debugging. Two skills plus a debug GUI:
- **playwright-cli** — browser automation via CDP (snapshots, eval, video, tracing)
- **walkthrough** — interactive debug agent that pauses failing E2E tests, inspects the live app via CDP, asks QA to triage, and fixes selectors/code in place
- **debug-gui** (`packages/debug-gui/`) — web GUI that wraps walkthrough sessions for non-technical QA. Launch: `node packages/debug-gui/bin/debug-gui.js` (or `npx @debug-tools/ui` once published).

## Commands

```bash
# Install dependencies
npm install

# Run walkthrough hook verification (pause/continue signaling)
bash test/walkthrough-hook-test/verify-hook.sh

# Run WDIO E2E tests against saucedemo.com (3 intentionally wrong selectors)
npx mocha test/walkthrough-e2e-wdio/login.spec.js \
  --require test/walkthrough-e2e-wdio/wdio-setup.js --timeout 30000

# Run WDIO tests WITH walkthrough (decorator + HTTP IPC, no --require needed)
WALKTHROUGH_PORT=3456 npx mocha test/walkthrough-e2e-wdio/login.spec.js \
  --require test/walkthrough-e2e-wdio/wdio-setup.js --timeout 60000

# Full WDIO walkthrough verification (automated pause/continue for all 3 failures)
bash test/walkthrough-e2e-wdio/verify-wdio.sh

# Build the debug GUI (server + web)
npm run build -w @debug-gui/server && npm run build -w @debug-gui/web

# Run the debug GUI locally (requires builds)
node packages/debug-gui/bin/debug-gui.js

# Debug GUI unit tests
npm run test -w @debug-gui/server && npm run test -w @debug-gui/web

# Debug GUI smoke test (launches server, hits /api/init)
bash packages/debug-gui/test/smoke.sh

# Syntax-check a file
node -c path/to/file.js
```

## Architecture

### Walkthrough Session Flow (v2 — HTTP IPC)
1. Agent auto-detects framework (Mocha + WDIO, wrapper pattern, page object layout, selector strategy)
2. Runs mocha with `WALKTHROUGH_PORT=<port>` env var — decorator injects hooks automatically
3. On test failure: hook updates HTTP state to `paused`, blocks execution
4. Agent polls `GET /status`, reads `GET /paused` for failure details
5. Agent attaches to app via `playwright-cli attach --cdp=http://localhost:9222`, inspects live DOM
6. Agent asks QA: real bug or environment issue? Applies fix if approved
7. Agent sends `POST /continue` to resume — hook unblocks
8. Repeats until status is `done`. No file cleanup needed.

### HTTP IPC Endpoints (`http://localhost:<WALKTHROUGH_PORT>`)
- `GET /status` — `{"state":"running|paused|done", ...}`
- `GET /paused` — failure details (test name, file, error, stack)
- `POST /continue` — signal hook to resume

### Debug GUI (`packages/debug-gui/`)
Two workspaces under a monorepo root:
- `server/` — Node + Express + `ws`. Orchestrates mocha spawn, hooker polling, CopilotClient session, WS hub. `src/index.ts` is the entry (`main(cwd, port)`).
- `web/` — Vite + React + Tailwind. Zustand store reduces ServerEvents; components render TestTree / FailureCard / DiffView / ChatDrawer / PickerOverlay.

Dev: `vite` on `:5555` proxies `/api` + `/ws` to backend on `:5556`. Prod: backend serves the built SPA at its port (default 5555, `PORT` env overrides).

### Skills Structure
- `.claude/skills/<name>/SKILL.md` — frontmatter (name, description, allowed-tools) + agent instructions
- `.claude/skills/playwright-cli/references/` — 9 reference docs for specific playwright-cli capabilities

## Conventions

- **Walkthrough** — `walkthrough-hooker.js` monkey patches `Runner.prototype.run`, activated by `WALKTHROUGH_PORT` env var. No `--require` needed. Compatible with custom `bin/mocha` wrappers and Mocha ^10.2.0 / ^11.0.0.
- **WDIO as library** — `remote()` for standalone sessions, not the WDIO testrunner; user's real tests use `Ws.instance.client.$()` wrapper
- **Page objects** — getter methods returning selector strings, stored in `pages/` subdirectories
- **CDP port 9222** — Chrome launched with `--remote-debugging-port=9222` for playwright-cli attachment
- **Test fixtures use intentionally wrong selectors** — the point is to exercise the walkthrough debug loop, not to pass
- **Debug GUI agent config** — `buildSessionConfig` passes `skillDirectories: [".claude/skills"]` so the Copilot CLI agent inherits the existing walkthrough / playwright-cli / identify-element SKILL.md content. Do not re-author skill content in server code.
- **playwright-cli invocation** — always shell out as `npx playwright-cli ...` (not bare `playwright-cli`). The CLI is bundled with `packages/debug-gui/`, not installed globally on QA machines.

## Key Rule

The walkthrough agent must **never guess selectors from training data**. It must inspect the live DOM via CDP (`playwright-cli snapshot` or `playwright-cli eval`) and propose fixes based on what it actually observes.
