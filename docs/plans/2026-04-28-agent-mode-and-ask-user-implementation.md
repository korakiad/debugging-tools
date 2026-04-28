# Agent Auto/Manual mode + ask_user prompt tool — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Auto/Manual agent mode toggle to debug-gui plus a generic `ask_user` agent tool that surfaces panel-style A/B/C choices to QA, replacing today's binary diff-only approval surface.

**Architecture:** New zod-validated `ask_user` tool follows the same `Promise + Map<reqId, resolver>` pattern as `edit_file` / `pick_element`. New `prompt` / `prompt_response` WS events plus a new `<PromptPanel>` web component. Mode lives in `config.agent.mode` (default `"auto"`); a toolbar `<ModeToggle>` flips it between runs. In manual mode the per-pause prompt prepends a directive that gates `edit_file` calls behind an `apply_*`-prefixed `ask_user` choice.

**Tech Stack:** TypeScript / Node / Express / `ws` / Vitest (server). React / Zustand / Tailwind / refinitiv-ui / Vitest (web). `@github/copilot-sdk` for tool definitions and session control.

**Design doc:** `docs/plans/2026-04-28-agent-mode-and-ask-user-design.md` (commit `bde282a`).

---

## Phase A — Server foundation (config + protocol + tool)

### Task 1: Extend `agent.mode` in `config.ts`

**Files:**
- Modify: `packages/debug-gui/server/src/config.ts`
- Test:   `packages/debug-gui/server/test/config.test.ts` (new file)

**Step 1: Write the failing tests first**

Create `packages/debug-gui/server/test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadConfig, saveConfig } from "../src/config.js";

function newPkg(extra: any = {}) {
    const dir = mkdtempSync(join(tmpdir(), "dgcfg-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", ...extra }, null, 2));
    return dir;
}

describe("config.agent.mode", () => {
    it("defaults to 'auto' when absent", () => {
        const dir = newPkg();
        expect(loadConfig(dir).agent.mode).toBe("auto");
    });

    it("loads 'manual' when set", () => {
        const dir = newPkg({ "debug-gui": { agent: { mode: "manual" } } });
        expect(loadConfig(dir).agent.mode).toBe("manual");
    });

    it("silently coerces unknown values to 'auto'", () => {
        const dir = newPkg({ "debug-gui": { agent: { mode: "bananas" } } });
        expect(loadConfig(dir).agent.mode).toBe("auto");
    });

    it("saveConfig round-trips mode and preserves idleTimeoutMs", () => {
        const dir = newPkg({ "debug-gui": { agent: { idleTimeoutMs: 60000 } } });
        const next = saveConfig(dir, { mode: "manual" });
        expect(next.agent.mode).toBe("manual");
        expect(next.agent.idleTimeoutMs).toBe(60000);
        const onDisk = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(onDisk["debug-gui"].agent.mode).toBe("manual");
        expect(onDisk["debug-gui"].agent.idleTimeoutMs).toBe(60000);
    });

    it("saveConfig back to 'auto' rewrites disk", () => {
        const dir = newPkg({ "debug-gui": { agent: { mode: "manual" } } });
        saveConfig(dir, { mode: "auto" });
        const onDisk = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(onDisk["debug-gui"].agent.mode).toBe("auto");
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -w @debug-gui/server -- config.test`
Expected: FAIL — `loadConfig(dir).agent.mode` is `undefined`, `saveConfig` rejects `mode` patch.

**Step 3: Implement**

Edit `packages/debug-gui/server/src/config.ts`:

- Extend the `DebugGuiConfig.agent` interface:
  ```ts
  agent: { idleTimeoutMs: number; mode: "auto" | "manual" };
  ```
- In `loadConfig`, after the existing `agent: { idleTimeoutMs: ... }` assembly, also read `mode`:
  ```ts
  const rawMode = dg.agent?.mode;
  const mode: "auto" | "manual" = rawMode === "manual" ? "manual" : "auto";
  return {
      ...,
      agent: { idleTimeoutMs: dg.agent?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, mode },
      ...
  };
  ```
- Extend `ConfigPatch`:
  ```ts
  export interface ConfigPatch {
      preRun?: string;
      idleTimeoutMs?: number;
      mode?: "auto" | "manual";
      discovery?: { ... };
  }
  ```
- In `saveConfig`, after the `idleTimeoutMs` clause, add:
  ```ts
  if (patch.mode !== undefined) {
      block.agent = { ...(block.agent ?? {}), mode: patch.mode };
  }
  ```

**Step 4: Run tests to verify they pass**

Run: `npm run test -w @debug-gui/server -- config.test`
Expected: PASS, all 5 tests.

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/config.ts packages/debug-gui/server/test/config.test.ts
git commit -m "feat(debug-gui): add agent.mode config field (auto|manual)"
```

---

### Task 2: Extend WS protocol (`messages.ts`)

**Files:**
- Modify: `packages/debug-gui/server/src/messages.ts`

**Step 1: Edit messages.ts**

Add to `ServerEvent`:
```ts
| {
    type: "prompt";
    reqId: string;
    summary: string;
    options: { id: string; label: string; detail?: string }[];
    allowFreeText: boolean;
  }
```

Add to `ClientCommand`:
```ts
| {
    type: "prompt_response";
    reqId: string;
    choice: string | null;
    freeText: string | null;
  }
```

Extend the existing `settings_update` member to add a top-level `mode?: "auto" | "manual"`:
```ts
| {
    type: "settings_update";
    preRun?: string;
    idleTimeoutMs?: number;
    mode?: "auto" | "manual";
    discovery?: { globs?: string[]; exclude?: string[]; extensions?: string[] };
  };
```

**Step 2: Type-check**

Run: `npm run build -w @debug-gui/server`
Expected: PASS. (No tests yet — wired up in later tasks.)

**Step 3: Commit**

```bash
git add packages/debug-gui/server/src/messages.ts
git commit -m "feat(debug-gui): add prompt/prompt_response WS events + mode on settings_update"
```

---

### Task 3: Create `ask_user` tool

**Files:**
- Create: `packages/debug-gui/server/src/tools/askUser.ts`
- Test:   `packages/debug-gui/server/test/tools/askUser.test.ts`

**Step 1: Write the failing tests**

Create `packages/debug-gui/server/test/tools/askUser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeAskUserTool } from "../../src/tools/askUser.js";

describe("ask_user tool", () => {
    it("returns the resolved choice + freeText to the agent", async () => {
        const tool = makeAskUserTool({
            onAsk: async () => ({ choice: "apply_a", freeText: null }),
        });
        const result = await (tool as any).handler(
            {
                summary: "test",
                options: [{ id: "apply_a", label: "Use [data-test=login]" }],
                allowFreeText: false,
            },
            {},
        );
        expect(result).toEqual({ choice: "apply_a", freeText: null });
    });

    it("propagates freeText when QA types instead of choosing", async () => {
        const tool = makeAskUserTool({
            onAsk: async () => ({ choice: null, freeText: "look at the modal first" }),
        });
        const result = await (tool as any).handler(
            { summary: "...", options: [], allowFreeText: true },
            {},
        );
        expect(result).toEqual({ choice: null, freeText: "look at the modal first" });
    });

    it("rejects malformed option id at parse time", async () => {
        const tool = makeAskUserTool({ onAsk: async () => ({ choice: null, freeText: null }) });
        // zod parse runs inside the SDK; here we directly invoke the schema.
        const schema = (tool as any).parameters;
        expect(() => schema.parse({
            summary: "x",
            options: [{ id: "Apply A!", label: "x" }],
            allowFreeText: false,
        })).toThrow();
    });

    it("caps options at 6", async () => {
        const tool = makeAskUserTool({ onAsk: async () => ({ choice: null, freeText: null }) });
        const schema = (tool as any).parameters;
        const tooMany = Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, label: `O${i}` }));
        expect(() => schema.parse({
            summary: "x",
            options: tooMany,
            allowFreeText: false,
        })).toThrow();
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -w @debug-gui/server -- askUser.test`
Expected: FAIL — `makeAskUserTool` doesn't exist.

**Step 3: Implement the tool**

Create `packages/debug-gui/server/src/tools/askUser.ts`:

```ts
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

export interface AskUserResult {
    choice: string | null;
    freeText: string | null;
}

export interface AskUserDeps {
    onAsk: (
        summary: string,
        options: { id: string; label: string; detail?: string }[],
        allowFreeText: boolean,
    ) => Promise<AskUserResult>;
}

const optionSchema = z.object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, "id must be snake_case"),
    label: z.string().min(1),
    detail: z.string().optional(),
});

const askUserSchema = z.object({
    summary: z.string().min(1).describe("1-line context for QA"),
    options: z.array(optionSchema).max(6),
    allowFreeText: z.boolean(),
});

export function makeAskUserTool(deps: AskUserDeps) {
    return defineTool<z.infer<typeof askUserSchema>>("ask_user", {
        description:
            "Ask QA a question with optional A/B/C-style suggested next steps. " +
            "In manual mode this is the only way to surface findings to QA before " +
            "calling edit_file. Option ids that apply a fix MUST start with 'apply_'.",
        parameters: askUserSchema,
        handler: async ({ summary, options, allowFreeText }) => {
            return await deps.onAsk(summary, options, allowFreeText);
        },
    });
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -w @debug-gui/server -- askUser.test`
Expected: PASS, 4 tests.

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/tools/askUser.ts packages/debug-gui/server/test/tools/askUser.test.ts
git commit -m "feat(debug-gui): add ask_user agent tool"
```

---

## Phase B — Server wiring (resolvers + orchestrator)

### Task 4: Add `resetResolvers` helper + regression test for pre-existing leak

**Files:**
- Modify: `packages/debug-gui/server/src/index.ts`
- Test:   `packages/debug-gui/server/test/resolverReset.test.ts` (new)

**Step 1: Write the failing test (resolver-leak regression)**

Create `packages/debug-gui/server/test/resolverReset.test.ts`:

```ts
import { describe, it, expect } from "vitest";

// Helper under test will be exported from src/resolvers.ts (extracted in step 3)
import { drainResolvers } from "../src/resolvers.js";

describe("drainResolvers", () => {
    it("rejects every pending resolver and clears the map", async () => {
        const m = new Map<string, (v: { ok: boolean }) => void>();
        const promises = [
            new Promise<{ ok: boolean }>((resolve, reject) => m.set("a", () => reject(new Error("session aborted")))),
            new Promise<{ ok: boolean }>((resolve, reject) => m.set("b", () => reject(new Error("session aborted")))),
        ];
        drainResolvers(m);
        await expect(promises[0]).rejects.toThrow("session aborted");
        await expect(promises[1]).rejects.toThrow("session aborted");
        expect(m.size).toBe(0);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -w @debug-gui/server -- resolverReset.test`
Expected: FAIL — `src/resolvers.ts` doesn't exist.

**Step 3: Extract the helper**

Create `packages/debug-gui/server/src/resolvers.ts`:

```ts
// Drain a resolver map by invoking each callback (it will reject the
// underlying promise) and clearing the map. Called from cancel and
// agent_abort to ensure pending edit/pick/ask tool calls don't leak
// across sessions.
export function drainResolvers<T>(map: Map<string, (value: T) => void>): void {
    for (const cb of map.values()) {
        try {
            cb(undefined as unknown as T);
        } catch {
            /* swallow — callbacks here are reject paths set up by callers */
        }
    }
    map.clear();
}
```

Wait — the test as written calls the resolver to *reject*, but `drainResolvers` here calls it as a generic resolve. Re-think.

The leak we're fixing is: today, `editResolvers.set(reqId, resolve)` stores the *resolve* callback of the outer Promise. Calling it with anything ends the await. To make `sendAndWait` propagate "session aborted", we want to *reject* the outer Promise on drain. So the cleanest shape is:

```ts
export interface PendingResolver<T> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

export function drainResolvers<T>(map: Map<string, PendingResolver<T>>): void {
    for (const r of map.values()) {
        try { r.reject(new Error("session aborted")); } catch { /* ignore */ }
    }
    map.clear();
}
```

Update the test accordingly:

```ts
import { drainResolvers, type PendingResolver } from "../src/resolvers.js";

describe("drainResolvers", () => {
    it("rejects every pending resolver and clears the map", async () => {
        const m = new Map<string, PendingResolver<{ ok: boolean }>>();
        const promises: Promise<{ ok: boolean }>[] = [];
        for (const id of ["a", "b"]) {
            promises.push(new Promise((resolve, reject) => m.set(id, { resolve, reject })));
        }
        drainResolvers(m);
        await expect(promises[0]).rejects.toThrow("session aborted");
        await expect(promises[1]).rejects.toThrow("session aborted");
        expect(m.size).toBe(0);
    });
});
```

**Step 4: Migrate `editResolvers` and `pickResolvers` in `index.ts` to the new shape**

Edit `packages/debug-gui/server/src/index.ts`:

- Replace:
  ```ts
  const editResolvers = new Map<string, (d: { approved: boolean; reason?: string }) => void>();
  const pickResolvers = new Map<string, (attrs: Record<string, unknown>) => void>();
  ```
  with:
  ```ts
  import { drainResolvers, type PendingResolver } from "./resolvers.js";
  const editResolvers = new Map<string, PendingResolver<{ approved: boolean; reason?: string }>>();
  const pickResolvers = new Map<string, PendingResolver<Record<string, unknown>>>();
  ```

- In `makeEditFileTool` wiring, replace the existing Promise body with:
  ```ts
  return new Promise((resolve, reject) => {
      editResolvers.set(reqId, { resolve, reject });
      hub.broadcast({ type: "diff", reqId, file, oldCode, newCode });
  });
  ```

- Same for `makePickElementTool` wiring (`pickResolvers.set(reqId, { resolve, reject })`).

- Update the `diff_decision` handler:
  ```ts
  if (cmd.type === "diff_decision") {
      const r = editResolvers.get(cmd.reqId);
      if (r) {
          r.resolve({ approved: cmd.action === "approved", reason: cmd.reason });
          editResolvers.delete(cmd.reqId);
      }
  }
  ```
  Same shape for `pick_result`.

- In the `cancel` and `agent_abort` handlers, after the existing `currentAgentSession.abort()` call, add:
  ```ts
  drainResolvers(editResolvers);
  drainResolvers(pickResolvers);
  ```

**Step 5: Run server tests to verify nothing broke**

Run: `npm run test -w @debug-gui/server`
Expected: PASS — all existing tests + new `resolverReset.test`.

**Step 6: Commit**

```bash
git add packages/debug-gui/server/src/resolvers.ts \
        packages/debug-gui/server/src/index.ts \
        packages/debug-gui/server/test/resolverReset.test.ts
git commit -m "fix(debug-gui): drain edit/pick resolvers on cancel/abort

Previously, cancel/agent_abort called agentSession.abort() but left
raw Promise resolvers in editResolvers/pickResolvers Maps untouched.
Those resolvers leaked across sessions. Extract a drainResolvers
helper, switch both Maps to {resolve, reject} pairs, and call drain
from both cancel and agent_abort. Ground for the upcoming ask_user
tool which uses the same shape."
```

---

### Task 5: Wire `ask_user` tool into `index.ts`

**Files:**
- Modify: `packages/debug-gui/server/src/index.ts`
- Modify: `packages/debug-gui/server/src/agent.ts` (extend `AgentDeps` if needed — review during step 1)

**Step 1: Wire the tool**

In `packages/debug-gui/server/src/index.ts`:

- Import: `import { makeAskUserTool } from "./tools/askUser.js";`
- Add to the resolvers section:
  ```ts
  const askResolvers = new Map<string, PendingResolver<{ choice: string | null; freeText: string | null }>>();
  ```
- Add to the `tools` array (alongside `makeEditFileTool` and `makePickElementTool`):
  ```ts
  makeAskUserTool({
      onAsk: (summary, options, allowFreeText) => {
          const reqId = Math.random().toString(36).slice(2);
          return new Promise((resolve, reject) => {
              askResolvers.set(reqId, { resolve, reject });
              hub.broadcast({ type: "prompt", reqId, summary, options, allowFreeText });
          });
      },
  }),
  ```
- Add a handler in `hub.onMessage`:
  ```ts
  if (cmd.type === "prompt_response") {
      const r = askResolvers.get(cmd.reqId);
      if (r) {
          r.resolve({ choice: cmd.choice, freeText: cmd.freeText });
          askResolvers.delete(cmd.reqId);
      }
  }
  ```
- Update the `cancel` and `agent_abort` handlers to also `drainResolvers(askResolvers);`.

**Step 2: Type-check**

Run: `npm run build -w @debug-gui/server`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/debug-gui/server/src/index.ts
git commit -m "feat(debug-gui): wire ask_user tool into orchestrator"
```

---

### Task 6: Mode preamble in paused-failure prompt

**Files:**
- Modify: `packages/debug-gui/server/src/index.ts`

**Step 1: Edit the `onChange(paused)` prompt builder**

Locate the `agentSession!.sendAndWait({ prompt: ... })` call inside the `onChange` handler in `index.ts` (around line 220-241). Refactor the prompt to be mode-aware:

```ts
const f = snap.currentFailure;
const manualPreamble =
    config.agent.mode === "manual"
        ? `You are in MANUAL mode. After each CDP/playwright-cli inspection, ` +
          `call ask_user with a 1-line summary and 2-3 suggested next steps as ` +
          `options. Option ids that apply a fix MUST start with 'apply_'. ` +
          `Do NOT call edit_file until QA chooses an apply_* option.\n\n`
        : "";
await agentSession!.sendAndWait(
    {
        prompt:
            manualPreamble +
            `A mocha test just failed and the walkthrough hook paused execution.\n\n` +
            // ... rest of existing prompt unchanged ...
    },
    config.agent.idleTimeoutMs,
);
```

**Step 2: Type-check**

Run: `npm run build -w @debug-gui/server`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/debug-gui/server/src/index.ts
git commit -m "feat(debug-gui): inject manual-mode preamble into paused-failure prompt"
```

---

### Task 7: Handle `mode` on `settings_update`

**Files:**
- Modify: `packages/debug-gui/server/src/index.ts`

**Step 1: Edit the `settings_update` handler**

In the `settings_update` block (around lines 305-345), after the `idleTimeoutMs` validation clause, add:

```ts
if (cmd.mode !== undefined) {
    if (cmd.mode !== "auto" && cmd.mode !== "manual") {
        hub.broadcast({ type: "error", message: "Save settings: mode must be 'auto' or 'manual'" });
        return;
    }
    patch.mode = cmd.mode;
}
```

**Step 2: Type-check + run server tests**

Run: `npm run build -w @debug-gui/server && npm run test -w @debug-gui/server`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/debug-gui/server/src/index.ts
git commit -m "feat(debug-gui): accept mode patches in settings_update"
```

---

## Phase C — Web foundation (store + PromptPanel)

### Task 8: Add `pendingPrompt` to store reducer

**Files:**
- Modify: `packages/debug-gui/web/src/state/store.ts`
- Modify: `packages/debug-gui/web/src/state/store.test.ts`

**Step 1: Write failing test**

Add to `packages/debug-gui/web/src/state/store.test.ts`:

```ts
it("sets pendingPrompt on prompt event", () => {
    useStore.getState().applyEvent({
        type: "prompt",
        reqId: "r1",
        summary: "Login button not found",
        options: [
            { id: "apply_a", label: "Use [data-test=login]" },
            { id: "investigate_b", label: "Inspect modal first" },
        ],
        allowFreeText: true,
    });
    const p = useStore.getState().pendingPrompt;
    expect(p?.reqId).toBe("r1");
    expect(p?.summary).toBe("Login button not found");
    expect(p?.options).toHaveLength(2);
    expect(p?.allowFreeText).toBe(true);
});

it("clears pendingPrompt when explicitly reset (response sent)", () => {
    useStore.setState({
        pendingPrompt: { reqId: "r1", summary: "x", options: [], allowFreeText: false },
    });
    useStore.setState({ pendingPrompt: null });
    expect(useStore.getState().pendingPrompt).toBeNull();
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -w @debug-gui/web -- store.test`
Expected: FAIL — `pendingPrompt` doesn't exist.

**Step 3: Implement**

In `packages/debug-gui/web/src/state/store.ts`:

- Add interface:
  ```ts
  export interface Prompt {
      reqId: string;
      summary: string;
      options: { id: string; label: string; detail?: string }[];
      allowFreeText: boolean;
  }
  ```
- Add to `Store`: `pendingPrompt: Prompt | null;`
- Initialize: `pendingPrompt: null,`
- Add reducer branch (next to `pick`):
  ```ts
  if (e.type === "prompt") {
      return {
          pendingPrompt: {
              reqId: e.reqId,
              summary: e.summary,
              options: e.options,
              allowFreeText: e.allowFreeText,
          },
      };
  }
  ```

**Step 4: Run tests to verify they pass**

Run: `npm run test -w @debug-gui/web -- store.test`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/debug-gui/web/src/state/store.ts packages/debug-gui/web/src/state/store.test.ts
git commit -m "feat(debug-gui): add pendingPrompt to web store"
```

---

### Task 9: Create `PromptPanel` component

**Files:**
- Create: `packages/debug-gui/web/src/components/PromptPanel.tsx`
- Test:   `packages/debug-gui/web/src/components/PromptPanel.test.tsx`

**Step 1: Write failing tests**

Create `packages/debug-gui/web/src/components/PromptPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PromptPanel } from "./PromptPanel";

describe("PromptPanel", () => {
    const baseProps = {
        summary: "Login button not found",
        options: [
            { id: "apply_a", label: "Use [data-test=login]", detail: "found via snapshot" },
            { id: "investigate_b", label: "Inspect modal first" },
        ],
    };

    it("renders summary, options, and option detail", () => {
        render(<PromptPanel {...baseProps} allowFreeText={false} onRespond={() => {}} />);
        expect(screen.getByText("Login button not found")).toBeInTheDocument();
        expect(screen.getByText("Use [data-test=login]")).toBeInTheDocument();
        expect(screen.getByText("found via snapshot")).toBeInTheDocument();
        expect(screen.getByText("Inspect modal first")).toBeInTheDocument();
    });

    it("calls onRespond with chosen option id when option clicked", () => {
        const onRespond = vi.fn();
        render(<PromptPanel {...baseProps} allowFreeText={false} onRespond={onRespond} />);
        fireEvent.click(screen.getByText("Use [data-test=login]"));
        expect(onRespond).toHaveBeenCalledWith({ choice: "apply_a", freeText: null });
    });

    it("does not render textarea when allowFreeText is false", () => {
        render(<PromptPanel {...baseProps} allowFreeText={false} onRespond={() => {}} />);
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("renders textarea + Send when allowFreeText is true", () => {
        const onRespond = vi.fn();
        render(<PromptPanel {...baseProps} allowFreeText={true} onRespond={onRespond} />);
        const ta = screen.getByRole("textbox");
        fireEvent.change(ta, { target: { value: "look at modal" } });
        fireEvent.click(screen.getByText("Send"));
        expect(onRespond).toHaveBeenCalledWith({ choice: null, freeText: "look at modal" });
    });

    it("clicking option with text in box sends both choice and freeText", () => {
        const onRespond = vi.fn();
        render(<PromptPanel {...baseProps} allowFreeText={true} onRespond={onRespond} />);
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "extra context" } });
        fireEvent.click(screen.getByText("Use [data-test=login]"));
        expect(onRespond).toHaveBeenCalledWith({ choice: "apply_a", freeText: "extra context" });
    });

    it("Send is disabled when no options and textarea empty", () => {
        render(
            <PromptPanel
                summary="x"
                options={[]}
                allowFreeText={true}
                onRespond={() => {}}
            />,
        );
        expect(screen.getByText("Send")).toBeDisabled();
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -w @debug-gui/web -- PromptPanel.test`
Expected: FAIL — component doesn't exist.

**Step 3: Implement**

Create `packages/debug-gui/web/src/components/PromptPanel.tsx`:

```tsx
import { useState } from "react";
import { EfButton, EfPanel } from "../ui";

export interface PromptOption {
    id: string;
    label: string;
    detail?: string;
}

export function PromptPanel({
    summary,
    options,
    allowFreeText,
    onRespond,
}: {
    summary: string;
    options: PromptOption[];
    allowFreeText: boolean;
    onRespond: (r: { choice: string | null; freeText: string | null }) => void;
}) {
    const [text, setText] = useState("");
    const trimmed = text.trim();
    const sendDisabled = options.length === 0 && trimmed.length === 0;

    return (
        <EfPanel spacing style={{ display: "block" }}>
            <div
                className="p-2 text-sm"
                style={{ borderBottom: "1px solid var(--ef-border-color)" }}
            >
                {summary}
            </div>
            <div className="p-2 flex flex-col gap-2">
                {options.map((o) => (
                    <EfButton
                        key={o.id}
                        onClick={() =>
                            onRespond({
                                choice: o.id,
                                freeText: trimmed.length > 0 ? trimmed : null,
                            })
                        }
                        style={{ display: "block", textAlign: "left" }}
                    >
                        <div className="font-bold">{o.label}</div>
                        {o.detail && (
                            <div className="text-xs opacity-70">{o.detail}</div>
                        )}
                    </EfButton>
                ))}
            </div>
            {allowFreeText && (
                <div
                    className="p-2 flex flex-col gap-2"
                    style={{ borderTop: "1px solid var(--ef-border-color)" }}
                >
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={2}
                        className="p-1 text-sm rounded"
                        style={{
                            background: "var(--ef-content-primary-background-color)",
                            border: "1px solid var(--ef-border-color)",
                            color: "var(--ef-color)",
                        }}
                    />
                    <EfButton
                        cta
                        disabled={sendDisabled || undefined}
                        onClick={() =>
                            onRespond({
                                choice: null,
                                freeText: trimmed.length > 0 ? trimmed : null,
                            })
                        }
                        style={{ alignSelf: "flex-end" }}
                    >
                        Send
                    </EfButton>
                </div>
            )}
        </EfPanel>
    );
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -w @debug-gui/web -- PromptPanel.test`
Expected: PASS, 6 tests.

**Step 5: Commit**

```bash
git add packages/debug-gui/web/src/components/PromptPanel.tsx \
        packages/debug-gui/web/src/components/PromptPanel.test.tsx
git commit -m "feat(debug-gui): add PromptPanel component"
```

---

## Phase D — Web wiring (App.tsx + ModeToggle)

### Task 10: Render `PromptPanel` in `App.tsx` with stacking rule

**Files:**
- Modify: `packages/debug-gui/web/src/App.tsx`

**Step 1: Edit App.tsx**

- Add import:
  ```tsx
  import { PromptPanel } from "./components/PromptPanel";
  ```
- Add store read alongside `diff` and `pick`:
  ```tsx
  const prompt = useStore((s) => s.pendingPrompt);
  ```
- Replace the existing `{diff && ...}` block with a stacked render where prompt wins:
  ```tsx
  {prompt ? (
      <PromptPanel
          summary={prompt.summary}
          options={prompt.options}
          allowFreeText={prompt.allowFreeText}
          onRespond={({ choice, freeText }) => {
              send({ type: "prompt_response", reqId: prompt.reqId, choice, freeText });
              useStore.setState({ pendingPrompt: null });
          }}
      />
  ) : (
      diff && (
          <DiffView
              file={diff.file}
              oldCode={diff.oldCode}
              newCode={diff.newCode}
              onApprove={() => {
                  send({ type: "diff_decision", reqId: diff.reqId, action: "approved" });
                  useStore.setState({ pendingDiff: null });
              }}
              onReject={() => {
                  send({ type: "diff_decision", reqId: diff.reqId, action: "rejected", reason: "" });
                  useStore.setState({ pendingDiff: null });
              }}
          />
      )
  )}
  ```

**Step 2: Run web tests**

Run: `npm run test -w @debug-gui/web`
Expected: PASS — `App.test.tsx` and others still pass.

**Step 3: Commit**

```bash
git add packages/debug-gui/web/src/App.tsx
git commit -m "feat(debug-gui): render PromptPanel in App with diff stacking rule"
```

---

### Task 11: Create `ModeToggle` and integrate into toolbar

**Files:**
- Create: `packages/debug-gui/web/src/components/ModeToggle.tsx`
- Test:   `packages/debug-gui/web/src/components/ModeToggle.test.tsx`
- Modify: `packages/debug-gui/web/src/App.tsx`

**Step 1: Write failing tests**

Create `packages/debug-gui/web/src/components/ModeToggle.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeToggle } from "./ModeToggle";

describe("ModeToggle", () => {
    it("renders Auto and Manual buttons with active state", () => {
        render(<ModeToggle mode="auto" disabled={false} onChange={() => {}} />);
        expect(screen.getByText("Auto")).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByText("Manual")).toHaveAttribute("aria-pressed", "false");
    });

    it("fires onChange when clicking the inactive option", () => {
        const onChange = vi.fn();
        render(<ModeToggle mode="auto" disabled={false} onChange={onChange} />);
        fireEvent.click(screen.getByText("Manual"));
        expect(onChange).toHaveBeenCalledWith("manual");
    });

    it("does not fire onChange when clicking the already-active option", () => {
        const onChange = vi.fn();
        render(<ModeToggle mode="auto" disabled={false} onChange={onChange} />);
        fireEvent.click(screen.getByText("Auto"));
        expect(onChange).not.toHaveBeenCalled();
    });

    it("disables both buttons when disabled prop is true", () => {
        render(<ModeToggle mode="auto" disabled={true} onChange={() => {}} />);
        expect(screen.getByText("Auto")).toBeDisabled();
        expect(screen.getByText("Manual")).toBeDisabled();
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -w @debug-gui/web -- ModeToggle.test`
Expected: FAIL.

**Step 3: Implement**

Create `packages/debug-gui/web/src/components/ModeToggle.tsx`:

```tsx
export type AgentMode = "auto" | "manual";

export function ModeToggle({
    mode,
    disabled,
    onChange,
}: {
    mode: AgentMode;
    disabled: boolean;
    onChange: (next: AgentMode) => void;
}) {
    return (
        <div className="inline-flex rounded border" style={{ borderColor: "var(--ef-border-color)" }}>
            {(["auto", "manual"] as const).map((m) => {
                const active = mode === m;
                return (
                    <button
                        key={m}
                        type="button"
                        aria-pressed={active}
                        disabled={disabled}
                        className="px-2 py-1 text-xs disabled:opacity-40"
                        style={{
                            background: active ? "var(--ef-accent-color)" : "transparent",
                            color: active ? "var(--ef-content-primary-color)" : "inherit",
                        }}
                        onClick={() => {
                            if (!active) onChange(m);
                        }}
                    >
                        {m === "auto" ? "Auto" : "Manual"}
                    </button>
                );
            })}
        </div>
    );
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -w @debug-gui/web -- ModeToggle.test`
Expected: PASS.

**Step 5: Wire into App.tsx**

Edit `packages/debug-gui/web/src/App.tsx`:

- Add import:
  ```tsx
  import { ModeToggle, type AgentMode } from "./components/ModeToggle";
  ```
- Read mode from config:
  ```tsx
  const config = useStore((s) => s.config) as { preRun?: string; agent?: { mode?: AgentMode } } & DebugGuiConfigShape;
  const mode: AgentMode = config.agent?.mode === "manual" ? "manual" : "auto";
  ```
- Insert in the toolbar between Stop and the ⚙ button (before the `ml-auto` settings button):
  ```tsx
  <ModeToggle
      mode={mode}
      disabled={state.state === "running" || state.state === "pre-running" || state.state === "paused"}
      onChange={(m) => send({ type: "settings_update", mode: m })}
  />
  ```

**Step 6: Run web tests**

Run: `npm run test -w @debug-gui/web`
Expected: PASS — all suites green.

**Step 7: Commit**

```bash
git add packages/debug-gui/web/src/components/ModeToggle.tsx \
        packages/debug-gui/web/src/components/ModeToggle.test.tsx \
        packages/debug-gui/web/src/App.tsx
git commit -m "feat(debug-gui): add ModeToggle in toolbar"
```

---

## Phase E — Skill + smoke + integration

### Task 12: Update bundled walkthrough SKILL.md with manual-mode contract

**Files:**
- Modify: `packages/debug-gui/.claude/skills/walkthrough/SKILL.md` (bundled copy ONLY — do not touch repo-root `.claude/skills/walkthrough/SKILL.md`)

**Step 1: Read the file**

Run: `cat packages/debug-gui/.claude/skills/walkthrough/SKILL.md` (or use Read tool).

**Step 2: Append a new section near the bottom of the agent instructions**

Add a section titled `## Manual mode contract`:

```markdown
## Manual mode contract

When the orchestrator's prompt begins with "You are in MANUAL mode", the rules are:

1. After **every** CDP / playwright-cli inspection step (snapshot, eval, click, screenshot), call `ask_user` with:
   - a 1-line `summary` of what you observed
   - 2-3 `options` describing what you could do next
   - `allowFreeText: true` so QA can override
2. Option ids that **apply a fix** (i.e. would result in calling `edit_file`) MUST start with `apply_`.
   - Investigation options use any other snake_case id, e.g. `investigate_modal`.
3. Do NOT call `edit_file` until QA chooses an option whose id starts with `apply_`.
4. After QA chooses an `apply_*` option, call `edit_file` with the corresponding diff. The QA will then approve / reject the diff in the GUI.

Auto mode skips all of the above — investigate freely and call `edit_file` directly.
```

**Step 3: Sanity check the file still parses**

The file uses YAML frontmatter; ensure your edits are below the frontmatter block.

**Step 4: Commit**

```bash
git add packages/debug-gui/.claude/skills/walkthrough/SKILL.md
git commit -m "docs(debug-gui): add manual-mode contract to bundled walkthrough skill"
```

---

### Task 13: Smoke check that mode round-trips via `/api/init`

**Files:**
- Modify: `packages/debug-gui/test/smoke.sh`

**Step 1: Read existing smoke.sh**

Run: `cat packages/debug-gui/test/smoke.sh`

**Step 2: Add a single new assertion**

Adjacent to the existing `/api/init` shape check, add: parse `config.agent.mode` from the response and assert it is `"auto"` (the default for an unconfigured fixture). Use whatever assertion idiom the existing file uses (likely `jq` or grep). Do **not** spin up a manual-mode fixture — the value comes from the consumer's `package.json` and the existing smoke fixture has no `agent.mode` field, so we're verifying the default.

If the existing smoke.sh uses `jq`:

```bash
mode=$(curl -s "$URL/api/init" | jq -r '.config.agent.mode')
[ "$mode" = "auto" ] || { echo "FAIL: expected agent.mode=auto, got '$mode'"; exit 1; }
echo "OK: agent.mode default = auto"
```

**Step 3: Run smoke**

Run: `bash packages/debug-gui/test/smoke.sh`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/debug-gui/test/smoke.sh
git commit -m "test(debug-gui): smoke-check default agent.mode in /api/init"
```

---

### Task 14: Server integration test for `ask_user` WS round-trip

**Files:**
- Create: `packages/debug-gui/server/test/askUser.integration.test.ts`

**Step 1: Write the integration test**

This test stands up the Express + WS server with a stub `onAsk` and exercises a full prompt → prompt_response cycle.

```ts
import { describe, it, expect } from "vitest";
import http from "http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createApp, WsHub } from "../src/server.js";
import { HookerClient } from "../src/hooker.js";
import { drainResolvers, type PendingResolver } from "../src/resolvers.js";

describe("ask_user WS round-trip", () => {
    it("resolves the resolver when client sends prompt_response", async () => {
        const hub = new WsHub();
        const askResolvers = new Map<string, PendingResolver<{ choice: string | null; freeText: string | null }>>();

        const app = createApp({
            cwd: process.cwd(),
            loadInit: () => ({ suites: [], config: {}, state: { state: "idle" } }),
            hooker: new HookerClient(),
        });
        const server = http.createServer(app);
        const wss = new WebSocketServer({ server, path: "/ws" });
        wss.on("connection", (ws) => {
            hub.add(ws);
            ws.on("message", (raw) => hub.handleIncoming(raw.toString()));
            ws.on("close", () => hub.remove(ws));
        });

        hub.onMessage((cmd) => {
            if (cmd.type === "prompt_response") {
                const r = askResolvers.get(cmd.reqId);
                if (r) {
                    r.resolve({ choice: cmd.choice, freeText: cmd.freeText });
                    askResolvers.delete(cmd.reqId);
                }
            }
        });

        await new Promise<void>((resolve) => server.listen(0, resolve));
        const port = (server.address() as any).port;

        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        await new Promise((resolve) => ws.on("open", resolve));

        const reqId = "test-req";
        const pending = new Promise<{ choice: string | null; freeText: string | null }>((resolve, reject) => {
            askResolvers.set(reqId, { resolve, reject });
            hub.broadcast({
                type: "prompt",
                reqId,
                summary: "test",
                options: [{ id: "apply_a", label: "A" }],
                allowFreeText: true,
            });
        });

        // Read the prompt event (init also gets sent — skip it).
        ws.on("message", (raw) => {
            const evt = JSON.parse(raw.toString());
            if (evt.type === "prompt") {
                ws.send(JSON.stringify({
                    type: "prompt_response",
                    reqId: evt.reqId,
                    choice: "apply_a",
                    freeText: null,
                }));
            }
        });

        const result = await pending;
        expect(result).toEqual({ choice: "apply_a", freeText: null });

        ws.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }, 5000);
});
```

**Step 2: Run the integration test**

Run: `npm run test -w @debug-gui/server -- askUser.integration.test`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/debug-gui/server/test/askUser.integration.test.ts
git commit -m "test(debug-gui): integration test for ask_user WS round-trip"
```

---

## Phase F — Manual verification + ship

### Task 15: Manual verification against saucedemo WDIO fixtures

**Files:** none changed; this is a verify-by-running step.

**Step 1: Build everything**

Run:
```bash
npm run build -w @debug-gui/server && npm run build -w @debug-gui/web
```
Expected: clean build.

**Step 2: Run debug-gui in auto mode (default)**

Run: `node packages/debug-gui/bin/debug-gui.js`

Pick the saucedemo login spec (3 intentionally wrong selectors). Click Start.

**Expected behaviour:** Same as today — agent investigates, calls `edit_file`, QA approves diffs, test resumes.

Stop the GUI.

**Step 3: Run debug-gui in manual mode**

Edit the consumer's `package.json` (whichever directory you're running against) to add:
```json
"debug-gui": { "agent": { "mode": "manual" } }
```

Or use the GUI: relaunch, click the Auto/Manual toggle while idle.

Run the saucedemo login spec again.

**Expected behaviour:**
- After the first failure pauses, agent does CDP inspection, then surfaces a `PromptPanel` with 2-3 options + a textarea.
- Click "Inspect [data-test=login-button]" (or whichever investigate option appears) → agent inspects further and shows another panel.
- Eventually click the `apply_*` option → agent calls `edit_file` → DiffView appears.
- Approve diff → Continue → next failure pauses → loop.

Stop when satisfied. If anything misbehaves, capture details and fix in a follow-up commit.

**Step 4: Run all server + web tests one final time**

Run: `npm run test -w @debug-gui/server && npm run test -w @debug-gui/web`
Expected: PASS all suites.

**Step 5: No commit needed unless fixes were made.**

---

### Task 16: Bump version + final commit

**Files:**
- Modify: `packages/debug-gui/package.json` (bump from `0.3.0` → `0.4.0`)

**Step 1: Edit package.json**

Bump the `version` field of `@debug-tools/ui` from `0.3.0` to `0.4.0` (minor — new feature, backwards-compatible since `agent.mode` defaults to `"auto"`).

**Step 2: Commit**

```bash
git add packages/debug-gui/package.json
git commit -m "chore(debug-gui): release 0.4.0"
```

**Step 3: Push branch**

Run: `git push origin feature/debug-gui` (only if user confirms — branch already exists upstream).

---

## Reference: testing infra at a glance

- Server unit + integration tests: `vitest`, run via `npm run test -w @debug-gui/server`. Test files live under `packages/debug-gui/server/test/`.
- Web component tests: `vitest` + `@testing-library/react` + `jsdom`, run via `npm run test -w @debug-gui/web`. Test files live next to components.
- Smoke: `packages/debug-gui/test/smoke.sh` — bash, hits `/api/init`. Run with `bash packages/debug-gui/test/smoke.sh`.
- E2E (separate): `bash test/walkthrough-e2e-wdio/verify-wdio.sh` — out of scope for this plan.

## Reference: relevant skills

- @superpowers:test-driven-development — every task above follows red/green/commit.
- @superpowers:verification-before-completion — before claiming done in Task 15, actually run both modes against fixtures.
- @superpowers:executing-plans — drives the task-by-task loop.
