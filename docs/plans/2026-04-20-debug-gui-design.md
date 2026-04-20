# Debug GUI — Design

**Date:** 2026-04-20
**Status:** Approved (brainstorming)
**Owner:** QA tooling team
**Supersedes:** nothing — additive to existing walkthrough skill

## Problem

QA currently debugs failing E2E tests via `/walkthrough` in Claude Code CLI.
Non-technical QA ("ซื่อบื้อ") struggles with terminal typing, reading raw HTTP
output, and managing multiple tool windows. We want a GUI that preserves full
agent capability but hides the complexity — like Playwright's UI mode, but
driven by our existing walkthrough + playwright-cli + identify-element skills.

## Goals

- **GUI-first UX** — QA clicks, sees screenshots, reviews diffs. No CLI typing.
- **Reuse existing skills** — `.claude/skills/{walkthrough,playwright-cli,identify-element}/SKILL.md`
  inject into agent context via Copilot SDK `skillDirectories`. No re-authoring.
- **Reuse walkthrough-hooker.js** — HTTP IPC (port 3456) unchanged. Server
  wraps `/status` `/paused` `/continue` as-is.
- **Auto-detect mocha suites** — read `package.json:mocha` config. QA never
  configures anything.
- **Agent = Copilot CLI via copilot-sdk** — spawned subprocess, driven by
  `skillDirectories` + custom tools. Not Claude Code.
- **Playwright UI style** — standalone web app, launched with `npx`, browser
  opens automatically. No editor integration required.

## Non-goals

- No VS Code extension (evaluated — rejected: QA wants standalone GUI).
- No Monaco editor embed. Diff view shows hunks; QA opens external editor if
  they want full file exploration.
- No live Chrome screencast iframe. Chrome runs headed; QA sees it directly.
- No multi-session support (v1 = one run at a time).
- No shell allowlist (POC = `approveAll`; production allowlist deferred to v2).
- No custom runner. Existing `mocha + walkthrough-hooker` stays as-is.
- No new hooker or IPC protocol.

## Architecture overview

```
QA's machine (local only)
─────────────────────────────────────────────────────────────
  Browser ──HTTP/WS── Debug Server ──spawn── {
                                               Copilot CLI (agent)
                                               mocha + walkthrough-hooker
                                               playwright-cli
                                             }
                                              │
                                              └── controls ── Chrome headed (CDP :9222)
```

### Ownership

| Process | Role | Controlled by |
|---|---|---|
| Browser (React SPA) | UI only — tree, cockpit, chat, picker, diff | User clicks |
| Debug Server (Node) | Orchestration — spawn, state, WS hub | SPA commands |
| Copilot CLI | Agent brain — reasoning, tool calls, fix proposals | Copilot SDK |
| Mocha + walkthrough-hooker | Run tests + pause on failure + HTTP IPC :3456 | Server spawn |
| playwright-cli | DOM inspection, screenshots, picker | Agent shell |
| Chrome (headed) | Real browser running tests | mocha/wdio spawn |

### Reuse versus new code

**Reused as-is (not modified):**

- `.claude/skills/walkthrough/SKILL.md` — agent system context
- `.claude/skills/playwright-cli/SKILL.md` + `references/*.md`
- `.claude/skills/identify-element/SKILL.md`
- `.claude/skills/walkthrough/walkthrough-hooker.js` — runtime HTTP IPC
- Test fixtures + verify scripts

**New — contained in `packages/debug-gui/`:**

```
packages/debug-gui/
├── server/                       # Node backend
│   ├── src/
│   │   ├── index.ts              # bin entry — discover, spawn, open browser
│   │   ├── server.ts             # Express + ws hub
│   │   ├── session.ts            # SessionManager state machine
│   │   ├── agent.ts              # CopilotClient wrapper + custom tools
│   │   ├── discovery.ts          # mocha suite detection
│   │   └── runner.ts             # spawn mocha + poll hooker
│   └── package.json
├── web/                          # React frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── TestTree.tsx
│   │   │   ├── Cockpit.tsx
│   │   │   ├── FailureCard.tsx
│   │   │   ├── DiffView.tsx
│   │   │   ├── ChatDrawer.tsx    # @assistant-ui/react
│   │   │   ├── PickerOverlay.tsx
│   │   │   └── PermissionModal.tsx
│   │   ├── hooks/useWebSocket.ts
│   │   └── state/store.ts
│   ├── vite.config.ts
│   └── package.json
└── bin/debug-gui.js              # npx entry
```

**New — infrastructure (minimal):**

- `.github/lsp.json` — Copilot CLI LSP config (TypeScript language server)
- `package.json:debug-gui` — cdp port, walkthrough port

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend framework | React + Vite + TypeScript | Ecosystem breadth, ready-made diff/tree libs |
| UI kit | shadcn/ui + Tailwind | Copy-paste components, not locked into a lib |
| Chat UI | `@assistant-ui/react` | Saves ~1 week of streaming/markdown/scroll edge cases |
| Code diff | `react-diff-viewer-continued` | Side-by-side, syntax-highlighted |
| Backend | Node 20 + Express | Team is familiar; not Hono |
| WebSocket | `ws` library | Streaming agent output + picker/diff round-trips |
| Agent SDK | `@github/copilot-sdk` | `skillDirectories`, custom tools, `overridesBuiltInTool` |
| Language server | `typescript-language-server` (npm global or dev dep) | Copilot CLI consumes via `.github/lsp.json` |
| Browser launcher | `open` npm package | Auto-open `http://localhost:5555` on start |

## Configuration

All config lives in the project's existing `package.json`. No `.debug-gui.json`
sidecar.

```json
{
  "mocha": {
    "file": ["./node_modules/@tr/mocha-runner-hooks/build/..."],
    "require": "tsx",
    "exclude": ["./test/playwright/**/*.ts"]
  },
  "debug-gui": {
    "cdp": { "port": 9222 },
    "walkthroughPort": 3456,
    "discovery": {
      "globs": ["test/**/*.spec.{js,ts}", "spec/**/*.test.{js,ts}"]
    }
  }
}
```

**Server reads `package.json:mocha`** for:
- `file[]` → propagate to spawn (chains with `@tr/mocha-runner-hooks`)
- `require` → propagate (supports `tsx`)
- `exclude` → filter from discovery tree

**Server reads `package.json:debug-gui`** for:
- `cdp.port` → pass to playwright-cli attach
- `walkthroughPort` → env var for hooker
- `discovery.globs` → fallback when no mocha spec config

`.github/lsp.json` (new, committed):

```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "fileExtensions": {
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript"
      }
    }
  }
}
```

Copilot CLI consumes this automatically — agent gets go-to-definition, hover,
diagnostics during edits. No code in our app handles LSP directly.

## Session lifecycle

State machine (single session):

```
idle → running → paused → agent-loop → running → ... → done
  ↑                                                       │
  └────────────── reset (QA new run) ─────────────────────┘
```

### Launch flow

1. `npx @debug-tools/ui` runs `bin/debug-gui.js`
2. Entry reads `package.json` at cwd → builds config + suite list
3. Spawns Express + ws on `:5555`
4. Calls `open('http://localhost:5555')` — browser opens
5. SPA loads → `GET /api/init` → `{ suites, config, state: 'idle' }`

### Run flow

1. QA clicks a spec in TestTree
2. Browser sends WS `{type: 'run', spec}`
3. Server spawns:
   ```
   WALKTHROUGH_PORT=3456 npx mocha <spec> [...args from package.json:mocha]
   ```
   mocha's native config loader reads `package.json:mocha` — file array, require,
   exclude — all applied automatically. walkthrough-hooker activates via env var.
4. Server redirects stdout to `/tmp/walkthrough-mocha.log` and begins polling
   `GET http://localhost:3456/status` every 500ms.
5. Server creates Copilot session:
   ```typescript
   await client.createSession({
       skillDirectories: [".claude/skills"],
       tools: [defineTool("pick_element", ...), editFileOverride],
       onPermissionRequest: approveAll,   // POC
   });
   ```
6. Agent idles until first paused event.

### Pause flow (agent debug loop)

When `/status` returns `paused`:

1. Server reads `/paused` → `{test, file, error, stack}`
2. Server broadcasts WS `{type: 'paused', failure}` → UI shows FailureCard
3. Server sends prompt to agent: "Test failed — follow walkthrough SKILL". SKILL.md
   content is already in context via `skillDirectories`.
4. Agent reasons and calls tools (all via Copilot's built-in shell/read plus our
   custom tools). Typical sequence:
   - `shell: cat /tmp/walkthrough-mocha.log` (tail for context)
   - `shell: cat <failing POM file>`
   - `shell: playwright-cli snapshot --depth=4`
   - `shell: playwright-cli --raw eval ...` (real element attributes)
   - LSP provides hover/diagnostics during reads (transparent to our code)
5. If agent needs QA to pick an element, calls `pick_element` tool — see below.
6. Agent calls overridden `edit_file` → diff modal — see below.
7. Agent calls `shell: curl -X POST http://localhost:3456/continue` to resume
   (per walkthrough SKILL.md guidance — no custom tool needed).

### Done flow

When `/status` returns `done`:

1. Server broadcasts `{type: 'status', state: 'done'}` + summary
2. UI shows timeline summary (pass/fail counts, fixes applied, tests skipped)
3. Copilot session disconnects
4. Mocha process exits
5. QA can click "Run again" → returns to idle → running

## Custom tools + overrides

Agent gets three tool categories:

### 1. `edit_file` override — intercept for diff modal

```typescript
defineTool("edit_file", {
    overridesBuiltInTool: true,
    description: "Edit a file after QA review. Shows diff to QA before writing.",
    parameters: z.object({
        path: z.string(),
        oldContent: z.string(),
        newContent: z.string(),
    }),
    handler: async ({ path, oldContent, newContent }) => {
        const decision = await session.proposeEdit(path, oldContent, newContent);
        if (decision.action === "approved") {
            await fs.writeFile(path, newContent);
            return { applied: true };
        }
        return { applied: false, rejection: decision.reason };
    },
});
```

Flow:
- Agent calls `edit_file` as it normally would
- Handler sends WS `{type: 'diff', file, oldCode, newCode, reqId}` → browser
- Browser renders `DiffView` with [Approve] [Reject] buttons
- User clicks → browser sends WS `{type: 'diff_decision', reqId, action, reason?}`
- Handler's Promise resolves → agent sees `{applied: true}` or `{applied: false, rejection}`
- Agent continues reasoning (may propose a different fix on rejection)

### 2. `pick_element` custom tool — visual picker

```typescript
defineTool("pick_element", {
    description: "Ask QA to visually click the target element. Returns DOM attributes.",
    parameters: z.object({
        hint: z.string().describe("natural-language description of the element"),
    }),
    handler: async ({ hint }) => {
        const imageUrl = await captureScreenshot();  // playwright-cli screenshot
        const result = await session.requestPick({ imageUrl, hint });
        return result;  // { tag, id, testid, aria, text, frameChain }
    },
});
```

Flow:
- Agent calls `pick_element({hint: "login button"})`
- Handler takes screenshot via playwright-cli
- WS `{type: 'pick', imageUrl, hint, reqId}` → browser shows `PickerOverlay`
- User clicks on element in screenshot
- Browser calls playwright-cli eval at click coordinates → gets element attrs
- Browser sends WS `{type: 'pick_result', reqId, attrs}`
- Handler resolves with attrs — agent builds selector, calls `edit_file`

SKILL.md's `identify-element` section tells agent to call this tool when a pick
is needed. No SKILL.md edit required — just register the tool name to match.

### 3. Built-in shell/read — preserved

Copilot's built-in `shell` and `read` tools remain available. Agent uses shell
to run `playwright-cli`, `curl`, `mocha`, `cat`, `grep`. This is how the
walkthrough SKILL.md already instructs the agent to operate.

POC permission handler:

```typescript
onPermissionRequest: approveAll
```

Production (deferred to v2): allowlist of safe shell patterns in
`package.json:debug-gui.allowlist.shell`. Documented in design doc section
"Deferred work" below.

## WebSocket message contract

```typescript
// Server → Browser
type ServerEvent =
  | { type: "init"; suites: Suite[]; config: Config; state: SessionState }
  | { type: "status"; state: SessionState }
  | { type: "test_progress"; test: string; result: "pass" | "fail" | "pending" }
  | { type: "paused"; failure: FailureInfo }
  | { type: "chat_delta"; text: string }
  | { type: "chat_final"; content: string }
  | { type: "diff"; reqId: string; file: string; oldCode: string; newCode: string }
  | { type: "pick"; reqId: string; imageUrl: string; hint: string }
  | { type: "permission"; reqId: string; request: PermissionRequest }  // v2
  | { type: "error"; message: string };

// Browser → Server
type ClientCommand =
  | { type: "run"; spec: string }
  | { type: "cancel" }
  | { type: "chat_send"; prompt: string }
  | { type: "diff_decision"; reqId: string; action: "approved" | "rejected"; reason?: string }
  | { type: "pick_result"; reqId: string; selector: string; attrs: Record<string, unknown> }
  | { type: "permission_decision"; reqId: string; decision: "approved" | "denied" };  // v2
```

## UI components (frontend)

```
App.tsx
├─ TestTree          left sidebar — suites auto-discovered, click to run
├─ Cockpit           main area
│   ├─ Timeline      pass/fail/pending icons per test (Playwright-style strip)
│   ├─ FailureCard   error, stack, breadcrumb (file:line), screenshot
│   └─ DiffView      old/new hunks, [Approve] [Reject] buttons
├─ ChatDrawer        right slide-out, @assistant-ui/react
├─ PickerOverlay     modal with screenshot; click handler → attrs
└─ PermissionModal   (v2 only)
```

Each component's props and state responsibilities are unambiguous from the
WebSocket contract above. Implementation plan details them further.

## Error handling

Principle: **fail-loud, no auto-retry**. Errors surface as a red banner in the
UI with actionable next-step text. QA re-runs via the same button.

| Failure | Surface | Recovery |
|---|---|---|
| Mocha spawn fails (command not found, permission) | Banner with stderr | QA checks install, clicks run again |
| Port 3456 busy | Banner "Another debug session may be running" | QA kills stale process; retry |
| Chrome CDP :9222 unreachable | Banner when agent calls playwright-cli | QA ensures Chrome launched with `--remote-debugging-port=9222` |
| Copilot CLI auth missing | Banner on session create fail | QA runs `gh auth login` / `copilot auth` |
| playwright-cli not installed | Banner on first agent shell call | QA installs dep |
| Agent hangs (no tool call for 60s) | Banner "Agent idle — cancel?" | QA clicks cancel |
| Browser closes mid-session | Server detects WS disconnect, keeps session alive | QA reopens tab; WS reconnects; server resends snapshot |
| `edit_file` write fails (EACCES, ENOSPC) | Diff modal shows error, agent gets rejection | Agent may propose alternative |
| mocha process crashes (not just test fail) | Banner "Test runner exited unexpectedly" | QA runs again; logs retained |

Implementation detail: each failure case gets a dedicated step in the plan.

## Testing strategy

| Layer | Approach |
|---|---|
| Unit — SessionManager state transitions | Vitest + mocked hooker |
| Unit — SuiteDiscovery parsing | Vitest + fixture `package.json` files |
| Unit — `edit_file` override handler | Vitest + stub `session.proposeEdit` |
| Integration — Server API endpoints | Supertest on Express app, ws-mock for WebSocket |
| E2E — full session with real mocha | Extend existing `test/walkthrough-e2e-wdio/verify-wdio.sh` to start `debug-gui` server + automate browser clicks via puppeteer or playwright |
| Smoke — `npx` launch | Script: start server, hit `GET /api/init`, assert `suites.length > 0`, kill |

Agent behavior (reasoning quality, tool-call patterns) is not directly tested
here — trust the existing walkthrough SKILL.md verification plus manual
eyeball during first runs.

## Deferred work (v2)

Documented so it's not lost:

- **Shell allowlist** — currently `approveAll`. Production must define
  `package.json:debug-gui.allowlist.shell` with regex patterns and route
  non-matching commands through `PermissionModal`. Patterns supplied by QA team
  based on SKILL.md investigation-toolkit usage.
- **Multi-session** — running two specs in parallel tabs. Requires port
  allocation per session + session registry + tab UI.
- **Live screencast** — if QA wants in-GUI browser preview instead of separate
  headed window, implement CDP `Page.screencastFrame` forwarding over WS.
- **Editor embed (Monaco)** — for QA who want full file exploration or to type
  custom selectors on reject.
- **`Open DevTools` button** — spawn `playwright-cli show` on demand (removed
  from v1 because Chrome headed already gives QA this via F12).
- **LSP edit via MCP server** — if raw text `edit_file` proves insufficient
  (e.g., rename-across-files fixes), integrate MCP LSP server for semantic
  edits via `workspace/applyEdit`.
- **First-run wizard** — if `package.json:debug-gui` is missing, scan project
  and propose config, let QA confirm.

## Dependencies (new)

### Runtime

- `@github/copilot-sdk` (Node SDK)
- `@github/copilot` (Copilot CLI — agent subprocess)
- `express`, `ws`, `open`, `glob`, `zod`
- Frontend: `react`, `vite`, `@assistant-ui/react`, `react-diff-viewer-continued`,
  `tailwindcss`, shadcn/ui snippets

### Dev / setup

- `typescript-language-server` (npm global or dev dep) — consumed by Copilot CLI via LSP config
- `@types/*` for Node/Express/ws/react
- Vitest, Supertest for tests

### External (user's machine)

- Node 18+
- Chrome with `--remote-debugging-port=9222` (QA launches or tests script does)
- GitHub Copilot subscription (licensed via the company account)

## Key rules (for future agents implementing this plan)

- **Do not modify `walkthrough-hooker.js`** — HTTP IPC protocol is stable.
- **Do not re-author SKILL.md files** — inject via `skillDirectories`.
- **Do not write a custom mocha runner** — spawn the user's existing mocha with
  env var. Trust mocha's native config loader.
- **Do not add shell allowlist logic in v1** — ship `approveAll`; leave TODO.
- **Do not add Monaco / iframe / screencast features** — listed as deferred.
- **Do not guess selectors** — same rule as walkthrough SKILL.md. Agent inspects
  live DOM via playwright-cli (now via LSP-aware edit), proposes fix based on
  what it observes.
