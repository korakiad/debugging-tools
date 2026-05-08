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

# Run WDIO tests WITH walkthrough (decorator + filesystem IPC, standalone skill)
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

- **Standalone skill** (`.claude/skills/walkthrough/`) — used when a developer invokes walkthrough from Claude Code CLI without the GUI. Uses the v1 filesystem protocol (`.walkthrough/status.json`, `.walkthrough/paused.json`, `.walkthrough/continue`). The hook is invoked via `--require` and activated by `WALKTHROUGH_PORT` env var (despite the name, the skill impl is filesystem-based).
- **Bundled in debug-gui** (`packages/debug-gui/server/runtime/mocha-ipc-launcher.cjs` + `mocha-ipc-hooks.cjs`) — v3 Node IPC channel. The debug-gui server `child_process.fork()`'s the launcher, which boots Mocha programmatically and pushes status/paused frames over the IPC channel. Parent-death is detected by `process.on('disconnect')`. No HTTP, no PID polling, no heartbeat, no exit-187.

### Walkthrough Session Flow (debug-gui v3 — Node IPC)
1. QA clicks Run in the GUI; server `fork()`'s `runtime/mocha-ipc-launcher.cjs` with `stdio: ['ignore','pipe','pipe','ipc']`. The pipes preserve the LogPanel feed; the IPC slot carries control frames.
2. The launcher reads the consumer's `package.json` `mocha.require` (mirroring what Mocha CLI auto-loads — e.g. `wdio-setup.js`), then `mocha.rootHooks(installHooks(...))` registers the bundled `beforeAll` / `beforeEach` / `afterEach` / `afterAll`.
3. `beforeAll` sends `{type:'status', state:'running', startedAt}` over IPC.
4. On test failure: `afterEach` sends `{type:'paused', failure}` and `await`s a `ManualPromise` that the IPC `process.on('message')` handler resolves on `{type:'resume'}` or `{type:'stop'}`.
5. Server-side `WorkerLink` translates inbound frames into `SessionManager` transitions → WS broadcast → UI pauses (no polling lag).
6. Copilot agent session gets the failure info inlined in its prompt, inspects the live app via playwright-cli CDP, proposes edits.
7. QA clicks Continue → `WorkerLink.sendResume()` writes `{type:'resume'}` → worker's resume promise resolves → afterEach returns → Mocha replays the test (built-in retries).
8. Parent-death: when the GUI process exits, the IPC pipe closes, the worker's `process.on('disconnect')` fires `gracefulCloseAndExit` (5 s WDIO `deleteSession` cap, then `process.exit(0)`).
9. Stop while paused: server calls `MochaRunner.sendStopAndKill()` → writes `{type:'stop'}` → afterEach throws → Mocha runs `afterAll` (WDIO `deleteSession`) → exits cleanly. If the worker hasn't exited within 5 s, falls back to `killTree()` (`taskkill /T /F` on Windows, `ps`-based descendant walk on POSIX).

### Worker IPC Protocol (`packages/debug-gui/server/src/workerProtocol.ts`)

Worker → Server (`WorkerOutbound`):
- `{type:'status', state:'running'|'done', startedAt?, resumedAt?, finishedAt?}`
- `{type:'paused', failure: FailureInfo}` — `failure` carries `test`, `file`, `error`, `stack`, plus runtime extras `attempt`, `maxAttempts`, `duration`, `pausedAt`
- `{type:'done', failures: number}` — emitted from the launcher's `mocha.run` callback before exit

Server → Worker (`WorkerInbound`):
- `{type:'resume'}` — resolves the afterEach pause promise with `action:'resume'`
- `{type:'stop'}` — resolves with `action:'stop'`, which throws inside afterEach so Mocha runs afterAll on its way out

### Debug GUI (`packages/debug-gui/`)
Two workspaces under a monorepo root:
- `server/` — Node + Express + `ws`. fork()s the IPC launcher, attaches a `WorkerLink` for state translation, runs the CopilotClient session, broadcasts via the WS hub. `src/index.ts` is the entry (`main(cwd, port)`).
- `web/` — Vite + React + Tailwind. Zustand store reduces ServerEvents; components render TestTree / FailureCard / DiffView / ChatDrawer / PickerOverlay.

Dev: `vite` on `:5555` proxies `/api` + `/ws` to backend on `:5556`. Prod: backend serves the built SPA at its port (default 5555, `PORT` env overrides).

### Skills Structure
- `.claude/skills/<name>/SKILL.md` — frontmatter (name, description, allowed-tools) + agent instructions
- `.claude/skills/playwright-cli/references/` — 9 reference docs for specific playwright-cli capabilities

## Conventions

- **Walkthrough** — standalone skill's hook (`.claude/skills/walkthrough/walkthrough-hooks.js`) is v1 filesystem, Mocha Root Hook Plugin, activated via `WALKTHROUGH_PORT` env var (name preserved for docs compatibility). Debug-gui's bundled hook (`packages/debug-gui/server/runtime/mocha-ipc-launcher.cjs` + `mocha-ipc-hooks.cjs`) is v3 Node IPC, fork()'d by the GUI server and addressed via `process.send` / `process.on('message')` (no env vars needed). `DEBUG_GUI_BAIL_ON_FAILURE=1` toggles the step-style retries-off + bail-siblings mode; `DEBUG_GUI_FORCE_EXIT_TIMEOUT_MS` (default 30000) caps graceful close on parent-disconnect.
- **WDIO as library** — `remote()` for standalone sessions, not the WDIO testrunner; user's real tests use `Ws.instance.client.$()` wrapper
- **Page objects** — getter methods returning selector strings, stored in `pages/` subdirectories
- **CDP port 9222** — Chrome launched with `--remote-debugging-port=9222` for playwright-cli attachment
- **Test fixtures use intentionally wrong selectors** — the point is to exercise the walkthrough debug loop, not to pass
- **Debug GUI agent config — bundled-only SKILL scope** — `buildSessionConfig` (`packages/debug-gui/server/src/agent.ts`) passes only `BUNDLED_SKILLS_PATH` (the `packages/debug-gui/.claude/skills` directory shipped with `@debug-tools/ui`). The consumer project's `<cwd>/.claude/skills` is **not** consulted, because debug-gui is distributed to QA teams whose repos may carry stale or incompatible local skill copies that would silently shadow the bundled contract. To change agent behaviour in the GUI, edit `packages/debug-gui/.claude/skills/...`, not the standalone `.claude/skills/...` at the repo root (which is for the CLI walkthrough skill only). Do not re-author skill content in server code.
- **playwright-cli invocation** — always shell out as `npx playwright-cli ...` (not bare `playwright-cli`). The CLI is bundled with `packages/debug-gui/`, not installed globally on QA machines.
- **Diff rendering** — agent edit-suggestions render through `@pierre/diffs` (`<FileDiff>` + `parseDiffFromFile`) inside `packages/debug-gui/web/src/components/DiffView.tsx`. The Shiki worker pool is provided once at `web/src/main.tsx`; do not wrap individual diffs in their own provider.
- **LSP for type/symbol work** — the `debug-gui` workspaces are TypeScript-heavy and store/prop/message types are shared across `server/`, `web/`, and the runtime hook. Before changing a prop signature, removing an export, renaming a type, or verifying that a field exists on a store value, prefer the **LSP** tool (find references, hover types, goto definition) over Read + Grep. Falling back to `npm run build -w @debug-gui/web` only catches errors after the fact. Read/Grep are still right for prose, config, and unfamiliar files.

## Key Rule

The walkthrough agent must **never guess selectors from training data**. It must inspect the live DOM via CDP (`playwright-cli snapshot` or `playwright-cli eval`) and propose fixes based on what it actually observes.
