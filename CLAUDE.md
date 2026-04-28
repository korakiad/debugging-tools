# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Do Not Read

- `architect.md` (repo root) — human-only design notes maintained by the developer. AI sessions must not open, read, or cite this file. If the user asks about architecture, use the summaries in this CLAUDE.md and the source code; do not source from `architect.md`.

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

### Two distinct walkthrough contexts

- **Standalone skill** (`.claude/skills/walkthrough/`) — used when a developer invokes walkthrough from Claude Code CLI without the GUI. Still uses the v1 filesystem protocol (`.walkthrough/status.json`, `.walkthrough/paused.json`, `.walkthrough/continue`). The hook is invoked via `--require` and activated by `WALKTHROUGH_PORT` env var (despite the name, current skill impl is filesystem-based).
- **Bundled in debug-gui** (`packages/debug-gui/server/runtime/walkthrough-hooks.cjs`) — v2 HTTP IPC, hook-as-client design. The hook POSTs state to the debug-gui Express server and polls for continue. Parent-death detection via `process.kill(DEBUG_GUI_PID, 0)` polling (LSP-style). Exit code 187 on bail.

### Walkthrough Session Flow (debug-gui v2 — HTTP IPC)
1. QA clicks Run in the GUI; server spawns mocha with `DEBUG_GUI_PORT=<serverPort>` + `DEBUG_GUI_PID=<process.pid>` in env
2. `--require runtime/walkthrough-hooks.cjs` attaches Mocha Root Hooks
3. Hook `beforeAll` POSTs `/hook/status {state:"running"}` + starts 500ms watchdog
4. On test failure: hook POSTs `/hook/paused` with failure info, then polls `GET /hook/should-continue`
5. Server's Orchestrator polls `HookerClient.getStatus()` (in-process), emits session events → WS broadcast → UI pauses
6. Copilot agent session gets the failure info inlined in its prompt (no longer reads `.walkthrough/paused.json`), inspects app via playwright-cli CDP, proposes edits
7. QA clicks Continue → `hooker.postContinue()` flips flag → hook's next `GET /hook/should-continue` returns `{shouldContinue:true}` → hook resumes
8. Throughout: hook's watchdog pings `/hook/heartbeat` every 500ms AND probes `process.kill(DEBUG_GUI_PID, 0)`. If 3 HTTP fails OR OS-confirmed dead pid → `shouldAbort()` returns `{code:187, message}` → `process.exit(187)`

### HTTP IPC Endpoints (debug-gui server, `http://127.0.0.1:<DEBUG_GUI_PORT>`)
- `POST /hook/status` — body: `{state, startedAt?, pausedAt?, resumedAt?, finishedAt?}`
- `POST /hook/paused` — body: `{test, file, error, stack, suite?, duration?, pausedAt?}` (sets state to paused)
- `POST /hook/heartbeat` — body: `{pid, at}` — updates `lastHeartbeatAt`
- `GET /hook/should-continue` — returns `{shouldContinue: boolean}`, flag is consume-once

### Debug GUI (`packages/debug-gui/`)
Two workspaces under a monorepo root:
- `server/` — Node + Express + `ws`. Orchestrates mocha spawn, hooker polling, CopilotClient session, WS hub. `src/index.ts` is the entry (`main(cwd, port)`).
- `web/` — Vite + React + Tailwind. Zustand store reduces ServerEvents; components render TestTree / FailureCard / DiffView / ChatDrawer / PickerOverlay.

Dev: `vite` on `:5555` proxies `/api` + `/ws` to backend on `:5556`. Prod: backend serves the built SPA at its port (default 5555, `PORT` env overrides).

### Skills Structure
- `.claude/skills/<name>/SKILL.md` — frontmatter (name, description, allowed-tools) + agent instructions
- `.claude/skills/playwright-cli/references/` — 9 reference docs for specific playwright-cli capabilities

## Conventions

- **Walkthrough** — standalone skill's hook (`.claude/skills/walkthrough/walkthrough-hooks.js`) is v1 filesystem, Mocha Root Hook Plugin, activated via `WALKTHROUGH_PORT` env var (name preserved for docs compatibility). Debug-gui's bundled hook (`packages/debug-gui/server/runtime/walkthrough-hooks.cjs`) is v2 HTTP, activated via `DEBUG_GUI_PORT` + `DEBUG_GUI_PID` env vars.
- **WDIO as library** — `remote()` for standalone sessions, not the WDIO testrunner; user's real tests use `Ws.instance.client.$()` wrapper
- **Page objects** — getter methods returning selector strings, stored in `pages/` subdirectories
- **CDP port 9222** — Chrome launched with `--remote-debugging-port=9222` for playwright-cli attachment
- **Test fixtures use intentionally wrong selectors** — the point is to exercise the walkthrough debug loop, not to pass
- **Debug GUI agent config** — `buildSessionConfig` passes `skillDirectories: [".claude/skills"]` so the Copilot CLI agent inherits the existing walkthrough / playwright-cli / identify-element SKILL.md content. Do not re-author skill content in server code.
- **playwright-cli invocation** — always shell out as `npx playwright-cli ...` (not bare `playwright-cli`). The CLI is bundled with `packages/debug-gui/`, not installed globally on QA machines.
- **Diff rendering** — agent edit-suggestions render through `@pierre/diffs` (`<FileDiff>` + `parseDiffFromFile`) inside `packages/debug-gui/web/src/components/DiffView.tsx`. The Shiki worker pool is provided once at `web/src/main.tsx`; do not wrap individual diffs in their own provider.

## Key Rule

The walkthrough agent must **never guess selectors from training data**. It must inspect the live DOM via CDP (`playwright-cli snapshot` or `playwright-cli eval`) and propose fixes based on what it actually observes.
