# LSP Auto-Init for debug-gui Copilot Sessions

**Date:** 2026-05-05
**Status:** Approved (design)
**Scope:** `packages/debug-gui/server/src/lspInit.ts` (new), `packages/debug-gui/server/src/index.ts`, `packages/debug-gui/server/src/messages.ts`, `packages/debug-gui/web/src/state/store.ts`, `packages/debug-gui/web/src/components/LspWarningModal.tsx` (new), `packages/debug-gui/web/src/App.tsx`

## Problem

When the walkthrough agent proposes an edit, it sometimes fixes the targeted line correctly but also deletes nearby code it deems unnecessary — without verifying that the deleted code is referenced elsewhere. Because the agent currently has only text-based context, it cannot reliably check "is this symbol used somewhere I can't see?" before removing it.

GitHub Copilot CLI 0.1+ ships native LSP integration: when `.github/lsp.json` is present and the CLI is started with `--experimental`, the agent automatically uses LSP operations (go-to-definition, find-references, hover, rename, document/workspace symbols, implementation, call hierarchy) instead of text grep. This gives the model the ground truth needed to refrain from confidently deleting symbols that have outside references.

The debug-gui server already spawns the Copilot CLI on QA's behalf via `@github/copilot-sdk`. We can wire the LSP feature on once for QA, instead of asking every QA to set up LSP themselves.

## Goal

When the debug-gui server starts in a TS/JS project, ensure that the spawned Copilot session has LSP enabled:

1. **Detect** that a TypeScript LSP server is installed and runnable.
2. **Init** `<cwd>/.github/lsp.json` non-destructively if needed.
3. **Surface** any setup gap to QA via a clear popup with copy-paste install instructions.
4. **Always** pass `--experimental` to the spawned CLI so LSP refactoring tools register on the first turn.

## Non-goals

- **Auto-install** the LSP server. Touching the user's global package state without consent is out — popup tells QA what to run.
- **Bundling** `typescript-language-server` inside `@debug-tools/ui`. A bundled binary would force any committed `.github/lsp.json` to point at a path that only resolves on the QA's machine, breaking CI/teammates.
- **Multi-language support.** TypeScript only for now. Python/Go/etc. join when there is a concrete request.
- **Walkthrough SKILL.md prompt changes.** Per the Copilot CLI docs, the agent uses LSP automatically once configured — no prompt nudge needed.
- **User-level config** (`~/.copilot/lsp-config.json`). Project-level has higher priority and matches the use case (a per-repo concern).
- **Overwriting** an existing `lspServers.typescript` entry. The team's choice wins.

## Design

### Detection (`ensureLspConfig(cwd)`)

```ts
export interface LspInitResult {
  status: "ok" | "missing" | "broken" | "config-invalid" | "fs-error";
  message?: string;
  installCmd?: string;     // present when status === "missing" | "broken"
  stderrTail?: string;     // present when status === "broken"
}
export async function ensureLspConfig(cwd: string): Promise<LspInitResult>;
```

Step 1 — **Probe binary** by spawning `typescript-language-server --version` with a 1500 ms timeout (Windows: `shell:true` so the npm-installed shim resolves).

| Outcome | Result |
|---|---|
| `ENOENT` | `{status:"missing", installCmd:"npm install -g typescript-language-server"}` |
| Non-zero exit OR timeout | `{status:"broken", stderrTail:<last 2 KB>, installCmd:…}` |
| Exit 0 | continue to step 2 |

Step 2 — **Init / merge `<cwd>/.github/lsp.json`** (see next subsection).

### Config init (silent merge)

Default TS block (verbatim from official docs):

```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "fileExtensions": {
        ".ts":  "typescript",       ".tsx": "typescriptreact",
        ".js":  "javascript",       ".jsx": "javascriptreact",
        ".mjs": "javascript",       ".cjs": "javascript",
        ".mts": "typescript",       ".cts": "typescript"
      }
    }
  }
}
```

Pure helper `mergeLspConfig(existing: unknown, defaultBlock): { next: object; changed: boolean }`:

| Existing state | Action | Status returned |
|---|---|---|
| File missing | `mkdir -p .github`, write default block | `ok` |
| File present, valid JSON, no `lspServers.typescript` | Spread-merge `typescript` key only, preserve all other keys, write back with `JSON.stringify(_, null, 2)` + trailing newline | `ok` |
| File present, valid JSON, has `lspServers.typescript` | Skip — leave file untouched | `ok` |
| File present, invalid JSON | Do not touch | `config-invalid` (popup says "left untouched") |
| Write fails (EACCES, EROFS, …) | Surface errno | `fs-error` |

Idempotent: re-running with a correct config produces no fs writes.

### Server wiring

In `server/src/index.ts`:

1. At the top of `main(cwd, port)`, call `const lsp = await ensureLspConfig(cwd)`.
2. Pass `cliArgs: ["--experimental"]` to `new CopilotClient({...})` (line 106) **regardless** of `lsp.status` — even if LSP couldn't be enabled this run, the flag is harmless and avoids drift if the user later fixes their setup.
3. Cache `lsp` in module scope. The result does not change for the lifetime of this server process — re-detection requires a server restart, which is exactly what the popup tells QA to do.
4. When the WS hub gets its first client, broadcast a single `lsp/warning` event if `lsp.status !== "ok"`.

### WS event + frontend popup

New event in `server/src/messages.ts`:

```ts
export type LspWarning = {
  kind: "missing" | "broken" | "config-invalid" | "fs-error";
  message?: string;
  installCmd?: string;
  stderrTail?: string;
};
// added to ServerEvent union:
| { type: "lsp/warning"; warning: LspWarning }
```

`web/src/state/store.ts` adds:

```ts
lspWarning: LspWarning | null    // set by lsp/warning event, cleared by Dismiss
```

New component `web/src/components/LspWarningModal.tsx`:

- Modal overlay, dismissible (does not block test runs).
- Title varies by `kind` ("LSP server not installed" / "LSP server failed to start" / "LSP config is invalid JSON" / "Could not write LSP config").
- Body: human-readable `message`.
- If `installCmd`: `<pre>` with copy-to-clipboard button.
- Footer line on every variant: **"Restart debug-gui after fixing to retry detection."**
- Dismiss button → `lspWarning = null`.

Mounted at root in `App.tsx`; renders only when `lspWarning !== null`. Does not gate any other UI.

## Failure modes

| Scenario | Behavior |
|---|---|
| `typescript-language-server` not on PATH | `missing` popup, debug-gui still runs (agent without LSP precision). |
| `--version` exits non-zero or times out | `broken` popup with `stderrTail`, debug-gui still runs. |
| `.github/lsp.json` is invalid JSON | `config-invalid` popup, file not touched, debug-gui still runs. |
| `.github/` is read-only | `fs-error` popup, debug-gui still runs. |
| Anything in `ensureLspConfig` throws unexpectedly | Caught in `main`, logged, treated as `fs-error` popup. **Debug-gui must never crash from LSP init failure.** |

## Testing

**Vitest unit (`server/test/lspInit.test.ts`):**

- `mergeLspConfig` table-driven: empty/partial/full-with-typescript/malformed-JSON.
- `ensureLspConfig` against a temp dir with a mocked `spawn`:
  - `ENOENT` → `missing`.
  - Exit 0 + no `.github` → file created, `ok`.
  - Exit 0 + `.github/lsp.json` with other server → merged, `ok`.
  - Exit 0 + `.github/lsp.json` already has `typescript` → file untouched (compare mtime), `ok`.
  - Exit 1 → `broken` with stderr tail.

**Smoke (`packages/debug-gui/test/smoke.sh`):**

After launching, hit `/api/init` and assert response includes `lsp: { status: "ok" | … }`.

**Manual:**

1. Launch debug-gui in a fresh temp project with no `typescript-language-server` installed → popup appears with install command.
2. Install LSP, restart debug-gui → popup absent, `.github/lsp.json` written.
3. Pre-create `.github/lsp.json` with a custom `typescript` block, restart → file unchanged.
4. Pre-create `.github/lsp.json` with `lspServers.python` only, restart → `typescript` key added, `python` key preserved.

## Files touched

```
packages/debug-gui/server/src/lspInit.ts                       (new)
packages/debug-gui/server/src/index.ts                         (call ensureLspConfig + cliArgs)
packages/debug-gui/server/src/messages.ts                      (new event + LspWarning type)
packages/debug-gui/server/test/lspInit.test.ts                 (new, unit)
packages/debug-gui/web/src/state/store.ts                      (lspWarning field + reducer)
packages/debug-gui/web/src/components/LspWarningModal.tsx      (new)
packages/debug-gui/web/src/App.tsx                             (mount modal)
docs/plans/2026-05-05-lsp-init-design.md                       (this doc)
```
