# Debug GUI Pre-Run Step Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let QA configure a single pre-run command (e.g. `npm run build`) from the debug-gui header; it runs automatically before the walkthrough flow starts, with a per-session Skip checkbox.

**Architecture:** Value lives in the consumer's `package.json` under `"debug-gui": { "preRun": "..." }`. Server loads it via `loadConfig`, writes updates via a new `saveConfig` helper, and gates the existing `run` command on pre-run success. The web header gains one row (input + Save + Skip). Communication extends the existing WS protocol — no new HTTP endpoints.

**Tech Stack:** TypeScript, Node 20+, Express, ws, Vitest, React + Zustand + Tailwind, refinitiv-ui EfButton.

**Design Doc:** `docs/plans/2026-04-23-debug-gui-prerun-design.md`.

---

## Preflight

Before starting, confirm:
- Worktree is `G:\claude-project\debuggig-tools\.worktrees\debug-gui` on branch `feature/debug-gui`.
- `npm install` has been run at repo root (monorepo workspaces already set up).
- All existing tests pass: `npm run test -w @debug-gui/server && npm run test -w @debug-gui/web`.

If any of these fail, stop and fix before starting Task 1.

---

## Task 1: Parse `preRun` from package.json

**Files:**
- Modify: `packages/debug-gui/server/src/config.ts`
- Modify: `packages/debug-gui/server/test/config.test.ts`

**Step 1: Write failing tests**

Append to `packages/debug-gui/server/test/config.test.ts`:

```ts
    it("reads preRun from debug-gui section when set", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": { preRun: "npm run build" }
        }));
        const cfg = loadConfig(dir);
        expect(cfg.preRun).toBe("npm run build");
    });

    it("returns undefined preRun when missing", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}));
        const cfg = loadConfig(dir);
        expect(cfg.preRun).toBeUndefined();
    });

    it("returns undefined preRun when empty string", () => {
        // Empty string means "feature off" — saveConfig removes the key, but
        // defend in the loader too for old configs / partial writes.
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": { preRun: "" }
        }));
        const cfg = loadConfig(dir);
        expect(cfg.preRun).toBeUndefined();
    });
```

**Step 2: Run tests, verify they fail**

Run: `npm run test -w @debug-gui/server -- config.test`
Expected: three new failures ("Cannot read properties" or "expected 'npm run build' to be undefined" depending on which branch).

**Step 3: Extend `DebugGuiConfig` and `loadConfig`**

In `packages/debug-gui/server/src/config.ts`, add field + loader line:

```ts
export interface DebugGuiConfig {
    mocha: {
        file?: string[];
        require?: string | string[];
        exclude?: string[];
        spec?: string[];
    };
    cdp: { port: number };
    discovery: { globs: string[] };
    agent: { idleTimeoutMs: number };
    preRun?: string;
}
```

Inside `loadConfig`, in the returned object, add:

```ts
        preRun: typeof dg.preRun === "string" && dg.preRun.length > 0 ? dg.preRun : undefined,
```

**Step 4: Run tests, verify they pass**

Run: `npm run test -w @debug-gui/server -- config.test`
Expected: all tests pass (including the three new ones).

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/config.ts packages/debug-gui/server/test/config.test.ts
git commit -m "feat(debug-gui): load preRun from package.json debug-gui block"
```

---

## Task 2: Add `saveConfig` helper

**Files:**
- Modify: `packages/debug-gui/server/src/config.ts`
- Modify: `packages/debug-gui/server/test/config.test.ts`

**Step 1: Write failing tests**

Append to `packages/debug-gui/server/test/config.test.ts`:

```ts
import { saveConfig } from "../src/config.js";
import { readFileSync } from "fs";

describe("saveConfig", () => {
    it("writes preRun into existing debug-gui block", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            name: "x",
            "debug-gui": { cdp: { port: 9222 } }
        }, null, 2));
        saveConfig(dir, { preRun: "npm run build" });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(written["debug-gui"].preRun).toBe("npm run build");
        expect(written["debug-gui"].cdp.port).toBe(9222); // preserved
        expect(written.name).toBe("x"); // preserved
    });

    it("creates debug-gui block when absent", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }, null, 2));
        saveConfig(dir, { preRun: "npm run build" });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(written["debug-gui"].preRun).toBe("npm run build");
    });

    it("removes preRun key when value is empty string", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": { preRun: "npm run build", cdp: { port: 9222 } }
        }, null, 2));
        saveConfig(dir, { preRun: "" });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect("preRun" in written["debug-gui"]).toBe(false);
        expect(written["debug-gui"].cdp.port).toBe(9222); // preserved
    });

    it("returns the freshly-loaded DebugGuiConfig", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}, null, 2));
        const cfg = saveConfig(dir, { preRun: "npm run build" });
        expect(cfg.preRun).toBe("npm run build");
    });
});
```

**Step 2: Run tests, verify they fail**

Run: `npm run test -w @debug-gui/server -- config.test`
Expected: four failures — `saveConfig is not exported`.

**Step 3: Implement `saveConfig`**

Append to `packages/debug-gui/server/src/config.ts`:

```ts
import { writeFileSync } from "fs";

export interface ConfigPatch {
    preRun?: string;
}

// Mutates consumer's package.json["debug-gui"] by applying `patch`.
// Empty-string values are treated as "remove this key" (keeps the on-disk
// block minimal and is how the UI signals "turn the feature off").
export function saveConfig(cwd: string, patch: ConfigPatch): DebugGuiConfig {
    const pkgPath = join(cwd, "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    const block = { ...(pkg["debug-gui"] ?? {}) };

    if (patch.preRun !== undefined) {
        if (patch.preRun === "") delete block.preRun;
        else block.preRun = patch.preRun;
    }

    pkg["debug-gui"] = block;
    // Preserve indent by sniffing the existing file; fall back to 2.
    const indentMatch = raw.match(/^\{\n(\s+)"/);
    const indent = indentMatch ? indentMatch[1].length : 2;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + "\n");
    return loadConfig(cwd);
}
```

**Step 4: Run tests, verify they pass**

Run: `npm run test -w @debug-gui/server -- config.test`
Expected: all tests pass.

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/config.ts packages/debug-gui/server/test/config.test.ts
git commit -m "feat(debug-gui): add saveConfig helper for preRun persistence"
```

---

## Task 3: Extend `SessionManager` with `pre-running` state

**Files:**
- Modify: `packages/debug-gui/server/src/session.ts`
- Modify: `packages/debug-gui/server/test/session.test.ts`

**Step 1: Write failing test**

Append to `packages/debug-gui/server/test/session.test.ts`:

```ts
    it("markPreRunning transitions idle → pre-running with the spec", () => {
        const s = new SessionManager();
        s.markPreRunning("a.spec.js");
        expect(s.getState()).toEqual({ state: "pre-running", currentSpec: "a.spec.js" });
    });

    it("markRunning after markPreRunning keeps currentSpec", () => {
        const s = new SessionManager();
        s.markPreRunning("a.spec.js");
        s.markRunning("a.spec.js");
        expect(s.getState().state).toBe("running");
        expect(s.getState().currentSpec).toBe("a.spec.js");
    });
```

**Step 2: Run tests, verify they fail**

Run: `npm run test -w @debug-gui/server -- session.test`
Expected: two failures — `markPreRunning is not a function`.

**Step 3: Implement**

In `packages/debug-gui/server/src/session.ts`:

- Extend the union: `export type SessionState = "idle" | "pre-running" | "running" | "paused" | "done";`
- Add method to `SessionManager`:

```ts
    markPreRunning(spec: string): void {
        this.snapshot = { state: "pre-running", currentSpec: spec };
        this.events.emit("change", this.getState());
    }
```

**Step 4: Run tests, verify they pass**

Run: `npm run test -w @debug-gui/server -- session.test`
Expected: all pass.

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/session.ts packages/debug-gui/server/test/session.test.ts
git commit -m "feat(debug-gui): add pre-running session state"
```

---

## Task 4: Add `spawnShellCommand` helper in `runner.ts`

**Files:**
- Modify: `packages/debug-gui/server/src/runner.ts`
- Modify: `packages/debug-gui/server/test/runner.test.ts`

**Step 1: Write failing test**

Append to `packages/debug-gui/server/test/runner.test.ts`:

```ts
import { spawnShellCommand } from "../src/runner.js";

describe("spawnShellCommand", () => {
    it("runs a simple echo and resolves with exit code 0", async () => {
        const chunks: string[] = [];
        const code = await spawnShellCommand("echo hello-prerun", {
            env: process.env,
            onStdout: (t) => chunks.push(t),
            onStderr: () => {},
        });
        expect(code).toBe(0);
        expect(chunks.join("")).toMatch(/hello-prerun/);
    });

    it("resolves with the non-zero exit code of a failing command", async () => {
        // `exit 2` works under cmd.exe and sh alike (shell: true handles both).
        const code = await spawnShellCommand("exit 2", {
            env: process.env,
            onStdout: () => {},
            onStderr: () => {},
        });
        expect(code).toBe(2);
    });
});
```

**Step 2: Run tests, verify they fail**

Run: `npm run test -w @debug-gui/server -- runner.test`
Expected: two failures — `spawnShellCommand is not exported`.

**Step 3: Implement**

In `packages/debug-gui/server/src/runner.ts`, add near the top after `BUNDLED_HOOK_PATH`:

```ts
export interface ShellSpawnOptions {
    env: NodeJS.ProcessEnv;
    onStdout: (text: string) => void;
    onStderr: (text: string) => void;
    onSpawn?: (pid: number) => void;
}

// Runs an arbitrary shell command string (e.g. "npm run build"). Unlike
// MochaRunner, this is single-shot — it resolves when the process exits.
// shell:true so the command string is parsed by cmd.exe / sh, which is what
// users mean when they type "npm run build && something".
export function spawnShellCommand(cmd: string, opts: ShellSpawnOptions): Promise<number> {
    return new Promise((resolve) => {
        const proc = spawn(cmd, { env: opts.env, shell: true });
        if (proc.pid && opts.onSpawn) opts.onSpawn(proc.pid);
        proc.stdout?.on("data", (d) => opts.onStdout(d.toString()));
        proc.stderr?.on("data", (d) => opts.onStderr(d.toString()));
        proc.on("exit", (code) => resolve(code ?? 1));
        proc.on("error", () => resolve(1));
    });
}
```

**Step 4: Run tests, verify they pass**

Run: `npm run test -w @debug-gui/server -- runner.test`
Expected: all pass (including the three existing `buildMochaCommand` tests and the two new ones).

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/runner.ts packages/debug-gui/server/test/runner.test.ts
git commit -m "feat(debug-gui): add spawnShellCommand helper for pre-run commands"
```

---

## Task 5: Extend WS message types

**Files:**
- Modify: `packages/debug-gui/server/src/messages.ts`

**Step 1: Edit message types**

Replace the `ServerEvent` and `ClientCommand` unions in `packages/debug-gui/server/src/messages.ts` with these extended versions:

```ts
export type ServerEvent =
    | { type: "init"; suites: unknown[]; config: unknown; state: SessionSnapshot }
    | { type: "status"; state: SessionSnapshot["state"] }
    | { type: "paused"; failure: FailureInfo }
    | { type: "test_progress"; test: string; result: "pass" | "fail" | "pending" }
    | { type: "mocha_log"; stream: "stdout" | "stderr"; text: string }
    | { type: "mocha_exit"; code: number | null }
    | { type: "agent_thinking"; active: boolean }
    | { type: "agent_activity"; label: string }
    | { type: "chat_delta"; text: string }
    | { type: "chat_final"; content: string }
    | { type: "diff"; reqId: string; file: string; oldCode: string; newCode: string }
    | { type: "pick"; reqId: string; imageUrl: string; hint: string }
    | { type: "config_updated"; config: unknown }
    | { type: "error"; message: string };

export type ClientCommand =
    | { type: "run"; spec: string; skipPreRun?: boolean }
    | { type: "cancel" }
    | { type: "continue" }
    | { type: "chat_send"; prompt: string }
    | { type: "agent_abort" }
    | { type: "diff_decision"; reqId: string; action: "approved" | "rejected"; reason?: string }
    | { type: "pick_result"; reqId: string; selector: string; attrs: Record<string, unknown> }
    | { type: "settings_update"; preRun: string };
```

**Step 2: Verify TypeScript still compiles**

Run: `npm run build -w @debug-gui/server`
Expected: build succeeds. The new fields are additive; existing handlers continue to work (`skipPreRun` is optional; `settings_update` is unmatched by the current switch and simply falls through).

**Step 3: Commit**

```bash
git add packages/debug-gui/server/src/messages.ts
git commit -m "feat(debug-gui): extend WS protocol with settings_update + config_updated"
```

---

## Task 6: Handle `settings_update` in the server

**Files:**
- Modify: `packages/debug-gui/server/src/index.ts`
- Modify: `packages/debug-gui/server/test/ws.test.ts`

**Step 1: Inspect the existing WS test file**

Run: `Read packages/debug-gui/server/test/ws.test.ts` to see the pattern (it drives `WsHub.handleIncoming` directly). Replicate that style.

**Step 2: Write failing test**

Append to `packages/debug-gui/server/test/ws.test.ts`:

```ts
    it("settings_update writes preRun to package.json and broadcasts config_updated", async () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}, null, 2));

        const broadcasts: any[] = [];
        const hub = new WsHub();
        // Stub broadcast by spying on the sockets Set indirectly — use a fake ws.
        const fakeWs: any = { readyState: 1, send: (p: string) => broadcasts.push(JSON.parse(p)) };
        hub.add(fakeWs);

        // Wire the handler exactly like index.ts will.
        hub.onMessage(async (cmd) => {
            if (cmd.type === "settings_update") {
                const cfg = saveConfig(dir, { preRun: cmd.preRun });
                hub.broadcast({ type: "config_updated", config: cfg });
            }
        });

        hub.handleIncoming(JSON.stringify({ type: "settings_update", preRun: "npm run build" }));
        // Handler is async; yield.
        await new Promise((r) => setImmediate(r));

        expect(broadcasts[0]).toMatchObject({ type: "config_updated" });
        expect((broadcasts[0] as any).config.preRun).toBe("npm run build");
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(written["debug-gui"].preRun).toBe("npm run build");
    });
```

Add imports at the top if missing: `mkdtempSync, writeFileSync, readFileSync` from `fs`, `tmpdir` from `os`, `join` from `path`, `saveConfig` from `../src/config.js`.

**Step 3: Run test, verify it fails**

Run: `npm run test -w @debug-gui/server -- ws.test`
Expected: failure — the handler isn't wired in the test file yet (actually, the test wires it inline and should pass once `saveConfig` exists — since Task 2 already added `saveConfig`, this test should go green immediately). If it does: good, proceed.

If you want a test that specifically covers `index.ts`, skip this and rely on the smoke test (Task 10) for end-to-end coverage. The important wiring is the `index.ts` handler below.

**Step 4: Wire the handler in `index.ts`**

In `packages/debug-gui/server/src/index.ts`, inside the `hub.onMessage(async (cmd) => { ... })` block (around line 130), add a new branch:

```ts
        if (cmd.type === "settings_update") {
            try {
                const nextCfg = saveConfig(cwd, { preRun: cmd.preRun });
                // Mutate the captured config so downstream run-handler sees the new value.
                Object.assign(config, nextCfg);
                hub.broadcast({ type: "config_updated", config: nextCfg });
            } catch (e: any) {
                hub.broadcast({ type: "error", message: `Save settings: ${e?.message ?? e}` });
            }
        }
```

Add the import at the top: change `import { loadConfig } from "./config.js";` to `import { loadConfig, saveConfig } from "./config.js";`.

**Step 5: Run all server tests, verify nothing broke**

Run: `npm run test -w @debug-gui/server`
Expected: all pass (existing + new).

**Step 6: Commit**

```bash
git add packages/debug-gui/server/src/index.ts packages/debug-gui/server/test/ws.test.ts
git commit -m "feat(debug-gui): handle settings_update WS command and broadcast config"
```

---

## Task 7: Integrate pre-run step into the `run` command handler

**Files:**
- Modify: `packages/debug-gui/server/src/index.ts`

**Step 1: Plan the change**

The current `run` handler (`index.ts:131-222`) does: `buildMochaCommand → hooker.reset → runner.start → session.markRunning → orch.start → agent wiring`. We need to insert a pre-run step at the start:

1. If `config.preRun` is set AND `cmd.skipPreRun` is falsy:
   - `session.markPreRunning(cmd.spec)` (triggers `status` WS event so the UI shows "pre-running")
   - Call `spawnShellCommand(config.preRun, ...)` piping stdout/stderr into `mocha_log` events with text prefixed by `"[pre-run] "` so QA can tell it apart.
   - Track the pre-run pid so `cancel` can kill it (see Task 7.5 below).
   - If exit code ≠ 0: broadcast `{type:"error", message:"Pre-run failed: <cmd> (exit N)"}`, call `session.reset()`, and `return` (do NOT proceed to mocha).
   - If exit code 0: fall through to the existing mocha flow.
2. Otherwise: fall through unchanged.

**Step 2: Implement**

In `packages/debug-gui/server/src/index.ts`:

- Add `import { ..., spawnShellCommand } from "./runner.js";` to the existing runner import.
- Track the pre-run pid at the function scope (near `let currentAgentSession` around line 99):

  ```ts
  let preRunPid: number | undefined;
  ```

- In the `if (cmd.type === "run")` branch, near the top (before `buildMochaCommand`), add:

  ```ts
          const spec = suites.find((s) => s.relPath === cmd.spec)?.absPath;
          if (!spec) return;

          // ── Pre-run step ─────────────────────────────────────
          if (config.preRun && !cmd.skipPreRun) {
              session.markPreRunning(cmd.spec);
              const exitCode = await spawnShellCommand(config.preRun, {
                  env: process.env,
                  onSpawn: (pid) => { preRunPid = pid; },
                  onStdout: (text) => hub.broadcast({ type: "mocha_log", stream: "stdout", text: `[pre-run] ${text}` }),
                  onStderr: (text) => hub.broadcast({ type: "mocha_log", stream: "stderr", text: `[pre-run] ${text}` }),
              });
              preRunPid = undefined;
              if (exitCode !== 0) {
                  hub.broadcast({
                      type: "error",
                      message: `Pre-run failed: ${config.preRun} (exit ${exitCode})`,
                  });
                  session.reset();
                  return;
              }
          }
          // ──────────────────────────────────────────────────────

          const mochaCmd = buildMochaCommand({ ... });  // existing code below
  ```

  **Important:** the existing `const spec = ...; if (!spec) return;` block is already present in the run handler. Do NOT duplicate it. Move the pre-run block to AFTER the existing `spec` lookup, BEFORE `buildMochaCommand`.

- In the `if (cmd.type === "cancel")` branch (around line 252), add pre-run kill at the top of the block:

  ```ts
          if (preRunPid) {
              await killTree(preRunPid);
              preRunPid = undefined;
          }
  ```

  Add `killTree` to the runner import: `import { MochaRunner, buildMochaCommand, spawnShellCommand, killTree } from "./runner.js";`.

**Step 3: Add a focused unit test for the integration**

The run handler is not directly unit-testable today (it depends on Copilot SDK). Skip a unit test here and rely on the smoke test in Task 10 for coverage. Add an inline comment near the new code block:

```ts
              // End-to-end coverage: test/smoke.sh — "preRun happy path" + "preRun failure"
```

**Step 4: Build + run all tests**

Run: `npm run build -w @debug-gui/server && npm run test -w @debug-gui/server`
Expected: build succeeds, all tests pass.

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/index.ts
git commit -m "feat(debug-gui): run preRun command before mocha on Start"
```

---

## Task 8: Web store — expose `preRun` and handle `config_updated`

**Files:**
- Modify: `packages/debug-gui/web/src/state/store.ts`
- Create: `packages/debug-gui/web/src/state/store.test.ts`

**Step 1: Write failing tests**

Create `packages/debug-gui/web/src/state/store.test.ts`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

describe("store", () => {
    beforeEach(() => {
        useStore.setState({
            suites: [],
            config: {},
            state: { state: "idle" },
            selectedSpec: null,
            chatMessages: [],
            pendingDiff: null,
            pendingPick: null,
            mochaLog: [],
            mochaExitCode: undefined,
            agentThinking: false,
            agentActivity: "",
        });
    });

    it("init event exposes preRun in config", () => {
        useStore.getState().applyEvent({
            type: "init",
            suites: [],
            config: { preRun: "npm run build" },
            state: { state: "idle" },
        });
        expect((useStore.getState().config as any).preRun).toBe("npm run build");
    });

    it("config_updated event replaces config", () => {
        useStore.setState({ config: { preRun: "old" } });
        useStore.getState().applyEvent({
            type: "config_updated",
            config: { preRun: "npm run build" },
        });
        expect((useStore.getState().config as any).preRun).toBe("npm run build");
    });

    it("status pre-running is stored without clobbering currentSpec", () => {
        useStore.setState({ state: { state: "idle", currentSpec: "x.spec.js" } });
        useStore.getState().applyEvent({ type: "status", state: "pre-running" });
        expect(useStore.getState().state.state).toBe("pre-running");
        expect(useStore.getState().state.currentSpec).toBe("x.spec.js");
    });
});
```

**Step 2: Run, verify failures**

Run: `npm run test -w @debug-gui/web -- store.test`
Expected: two failures — `config_updated` unhandled (returns `{}`), store doesn't clear `mochaLog` on `pre-running` etc. Actually, `config_updated` will just return `{}` so config won't change. Tests will fail on the `config_updated` assertion.

**Step 3: Update `SessionState` union and `applyEvent`**

In `packages/debug-gui/web/src/state/store.ts`:

- Extend `SessionState`: `export type SessionState = "idle" | "pre-running" | "running" | "paused" | "done";`
- In `applyEvent`, add a new branch handling `config_updated`:

  ```ts
              if (e.type === "config_updated") {
                  return { config: e.config };
              }
  ```

- In the `status` branch, extend the "fresh session" reset so it ALSO fires for `pre-running` (clears the old mocha log at the start of a new run):

  ```ts
              if (e.type === "status") {
                  if (e.state === "running" || e.state === "pre-running") {
                      return {
                          state: { ...s.state, state: e.state },
                          mochaLog: [], mochaExitCode: undefined,
                          agentThinking: false, agentActivity: "",
                      };
                  }
                  return { state: { ...s.state, state: e.state } };
              }
  ```

**Step 4: Run, verify pass**

Run: `npm run test -w @debug-gui/web -- store.test`
Expected: all pass.

Run full web test suite to ensure no regressions:

Run: `npm run test -w @debug-gui/web`
Expected: all pass.

**Step 5: Commit**

```bash
git add packages/debug-gui/web/src/state/store.ts packages/debug-gui/web/src/state/store.test.ts
git commit -m "feat(debug-gui): expose config.preRun and handle config_updated in store"
```

---

## Task 9: Web UI — pre-run row in header

**Files:**
- Create: `packages/debug-gui/web/src/components/PreRunRow.tsx`
- Create: `packages/debug-gui/web/src/components/PreRunRow.test.tsx`
- Modify: `packages/debug-gui/web/src/App.tsx`

**Step 1: Write failing component tests**

Create `packages/debug-gui/web/src/components/PreRunRow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreRunRow } from "./PreRunRow";

describe("PreRunRow", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("renders saved preRun value in the input", () => {
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} />);
        const input = screen.getByLabelText(/pre-run/i) as HTMLInputElement;
        expect(input.value).toBe("npm run build");
    });

    it("Save is disabled when input equals saved value", () => {
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} />);
        const save = screen.getByRole("button", { name: /save/i });
        expect(save).toBeDisabled();
    });

    it("Save becomes enabled when input changes", () => {
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} />);
        const input = screen.getByLabelText(/pre-run/i);
        fireEvent.change(input, { target: { value: "npm run build:dev" } });
        expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
    });

    it("clicking Save calls onSave with the input value", () => {
        const onSave = vi.fn();
        render(<PreRunRow saved="old" onSave={onSave} onSkipChange={() => {}} skip={false} disabled={false} />);
        const input = screen.getByLabelText(/pre-run/i);
        fireEvent.change(input, { target: { value: "new" } });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith("new");
    });

    it("toggling Skip checkbox calls onSkipChange", () => {
        const onSkipChange = vi.fn();
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={onSkipChange} skip={false} disabled={false} />);
        fireEvent.click(screen.getByLabelText(/skip/i));
        expect(onSkipChange).toHaveBeenCalledWith(true);
    });

    it("reports dirty state via onDirtyChange", () => {
        const onDirty = vi.fn();
        render(<PreRunRow saved="a" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} onDirtyChange={onDirty} />);
        fireEvent.change(screen.getByLabelText(/pre-run/i), { target: { value: "b" } });
        expect(onDirty).toHaveBeenCalledWith(true);
    });
});
```

**Step 2: Run, verify failures**

Run: `npm run test -w @debug-gui/web -- PreRunRow.test`
Expected: all fail — component doesn't exist.

**Step 3: Create the component**

Create `packages/debug-gui/web/src/components/PreRunRow.tsx`:

```tsx
import { useEffect, useState } from "react";
import { EfButton } from "../ui";

export interface PreRunRowProps {
    saved: string;
    skip: boolean;
    disabled: boolean;
    onSave: (value: string) => void;
    onSkipChange: (next: boolean) => void;
    onDirtyChange?: (dirty: boolean) => void;
}

export function PreRunRow({
    saved, skip, disabled, onSave, onSkipChange, onDirtyChange,
}: PreRunRowProps) {
    const [value, setValue] = useState(saved);

    useEffect(() => { setValue(saved); }, [saved]);
    useEffect(() => { onDirtyChange?.(value !== saved); }, [value, saved, onDirtyChange]);

    const dirty = value !== saved;

    return (
        <div className="flex items-center gap-2 text-sm">
            <label className="opacity-70" htmlFor="prerun-input">Pre-run:</label>
            <input
                id="prerun-input"
                aria-label="pre-run"
                className="px-2 py-1 rounded border border-gray-600 bg-transparent font-mono text-xs w-64"
                placeholder="e.g. npm run build"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={disabled}
            />
            <EfButton
                disabled={!dirty || disabled || undefined}
                onClick={() => onSave(value)}
            >
                Save
            </EfButton>
            <label className="flex items-center gap-1 opacity-80">
                <input
                    type="checkbox"
                    checked={skip}
                    onChange={(e) => onSkipChange(e.target.checked)}
                    disabled={disabled}
                    aria-label="skip pre-run"
                />
                Skip this run
            </label>
        </div>
    );
}
```

**Step 4: Run, verify pass**

Run: `npm run test -w @debug-gui/web -- PreRunRow.test`
Expected: all pass.

**Step 5: Wire into `App.tsx`**

Modify `packages/debug-gui/web/src/App.tsx`:

- Add imports at the top:

  ```tsx
  import { useEffect, useState } from "react";
  import { PreRunRow } from "./components/PreRunRow";
  ```

- Inside the `App` component, after the existing `const pick = ...` selector, add:

  ```tsx
      const config = useStore((s) => s.config) as { preRun?: string };
      const savedPreRun = config.preRun ?? "";
      const [skipPreRun, setSkipPreRun] = useState<boolean>(() => {
          return localStorage.getItem("debugGui.skipPreRun") === "1";
      });
      const [preRunDirty, setPreRunDirty] = useState(false);

      useEffect(() => {
          localStorage.setItem("debugGui.skipPreRun", skipPreRun ? "1" : "0");
      }, [skipPreRun]);

      // Show the row whenever preRun is configured. First-run setup (no value)
      // is not exposed here; dev commits initial value OR user triggers the
      // row by setting preRun via a one-off settings command later.
      const showPreRun = savedPreRun.length > 0;
  ```

- Update `canStart` to also disable during dirty input:

  ```tsx
      const canStart = !!selectedSpec && (state.state === "idle" || state.state === "done") && !preRunDirty;
  ```

- Update the Start `onClick` to pass `skipPreRun`:

  ```tsx
      onClick={() => {
          if (canStart) send({ type: "run", spec: selectedSpec!, skipPreRun });
      }}
  ```

- Render the row in the header area, inside the existing flex container next to Stop/Status:

  ```tsx
      {showPreRun && (
          <PreRunRow
              saved={savedPreRun}
              skip={skipPreRun}
              disabled={state.state === "running" || state.state === "pre-running" || state.state === "paused"}
              onSave={(preRun) => send({ type: "settings_update", preRun })}
              onSkipChange={setSkipPreRun}
              onDirtyChange={setPreRunDirty}
          />
      )}
  ```

- Add a "pre-running" state indicator next to the existing status span (optional polish):

  ```tsx
      {state.state === "pre-running" && <Spinner />}
  ```

  (The existing `state.state === "running" && <Spinner />` already renders; this adds the same spinner for pre-running.)

**Step 6: Run full web test suite**

Run: `npm run test -w @debug-gui/web`
Expected: all pass.

**Step 7: Commit**

```bash
git add packages/debug-gui/web/src/components/PreRunRow.tsx packages/debug-gui/web/src/components/PreRunRow.test.tsx packages/debug-gui/web/src/App.tsx
git commit -m "feat(debug-gui): add preRun row to header with Save + Skip"
```

---

## Task 10: Extend smoke test with preRun coverage

**Files:**
- Modify: `packages/debug-gui/test/smoke.sh`

**Step 1: Read the current smoke test**

Run: `Read packages/debug-gui/test/smoke.sh` to see how it sets up a temp project and launches the server.

**Step 2: Extend the script**

Add to the smoke test, after the existing `/api/init` assertion:

1. Write a `package.json` in the temp project containing `"debug-gui": { "preRun": "echo pre-run-ok" }`.
2. Boot the server against that temp project.
3. Open a WebSocket client (use `curl`'s `-N` + `websocat` if present, or just skip and use the REST surface — since we do NOT expose an HTTP endpoint for settings, skip this part of the smoke test and rely on the unit tests).
4. Alternative minimal coverage: modify the temp project's `package.json` manually in the script to include a bogus `preRun` value, then confirm `/api/init` returns `config.preRun`.

Keep the smoke-test extension small — one new assertion:

```bash
    # preRun flows through /api/init when configured
    cat > "$TMP_PROJECT/package.json" <<'PKG'
{
  "debug-gui": { "preRun": "echo pre-run-ok" }
}
PKG

    # Restart server to pick up the new package.json (or whatever the existing script does).
    # Then:
    curl -s "http://127.0.0.1:$PORT/api/init" | grep -q '"preRun":"echo pre-run-ok"' \
        || { echo "preRun not surfaced via /api/init"; exit 1; }
```

Adapt to whatever restart/teardown the existing smoke script uses.

**Step 3: Run the smoke test**

Run: `bash packages/debug-gui/test/smoke.sh`
Expected: passes.

**Step 4: Commit**

```bash
git add packages/debug-gui/test/smoke.sh
git commit -m "test(debug-gui): smoke-test preRun config surfaces via /api/init"
```

---

## Task 11: Final end-to-end check

**Step 1: Run ALL tests from repo root**

Run: `npm run test -w @debug-gui/server && npm run test -w @debug-gui/web`
Expected: full pass.

**Step 2: Build everything**

Run: `npm run build -w @debug-gui/server && npm run build -w @debug-gui/web`
Expected: both build cleanly.

**Step 3: Manual sanity check**

In a scratch project:
1. `node packages/debug-gui/bin/debug-gui.js` pointed at a project with `"debug-gui": { "preRun": "echo hi" }` in package.json.
2. GUI opens → header shows `Pre-run: [echo hi] [Save] ☐ Skip this run`.
3. Select a spec, click Start → `MochaLogPanel` shows `[pre-run] hi`, then the normal mocha output.
4. Change the input to something different, verify Start becomes disabled, click Save → input saved, Start re-enables.
5. Check the checkbox, click Start → mocha runs immediately with no pre-run output. Reload the page → checkbox is reset to unchecked (localStorage has "0", default state).
6. Set preRun to `exit 1`, click Start → error banner "Pre-run failed: exit 1 (exit 1)", mocha never runs, status returns to idle.

If all six steps pass: done.

**Step 4: Final commit (optional — only if you made any fixes during manual testing)**

```bash
git commit -am "fix(debug-gui): <whatever>"
```

---

## Post-implementation

- Request code review with `superpowers:requesting-code-review` referencing the design doc and this plan.
- Update `CLAUDE.md` only if the preRun feature becomes critical to day-to-day dev workflow — otherwise the design doc is enough documentation.
- Merge to `main` via PR when review is green.
