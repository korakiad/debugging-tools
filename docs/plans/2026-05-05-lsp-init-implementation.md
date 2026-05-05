# LSP Auto-Init Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire LSP auto-detection + `.github/lsp.json` non-destructive merge into `debug-gui` server. Surface setup gaps via a popup modal in the web UI. Always start the spawned Copilot CLI with `--experimental` so LSP tools register on the first turn.

**Architecture:** A new server module `lspInit.ts` exposes one async function `ensureLspConfig(cwd)`. It runs once at server startup, before the first session is spawned, returning a result object that the server caches and broadcasts on the first WS connect. The web UI subscribes to a new `lsp/warning` event and renders a dismissible `<EfDialog>` with the install command + restart hint. The implementation is fully covered by Vitest unit tests using dependency injection (no global module mocking needed).

**Tech Stack:** Node 20+, TypeScript, Vitest 1.x, `@github/copilot-sdk` 0.3.x, React 19, Zustand 5, refinitiv-ui `ef-dialog`, Tailwind 3.

**Design doc:** `docs/plans/2026-05-05-lsp-init-design.md` (commit `df786ae`).

---

## Task 1: Pure `mergeLspConfig` helper + default TS block

**Files:**
- Create: `packages/debug-gui/server/src/lspInit.ts`
- Create: `packages/debug-gui/server/test/lspInit.test.ts`

**Step 1: Write the failing tests**

Write `packages/debug-gui/server/test/lspInit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeLspConfig, DEFAULT_TS_BLOCK } from "../src/lspInit.js";

describe("mergeLspConfig", () => {
    it("returns default block when existing is null", () => {
        const { next, changed } = mergeLspConfig(null);
        expect(changed).toBe(true);
        expect(next).toEqual(DEFAULT_TS_BLOCK);
    });

    it("adds typescript key when lspServers is empty", () => {
        const existing = { lspServers: {} };
        const { next, changed } = mergeLspConfig(existing);
        expect(changed).toBe(true);
        expect((next as any).lspServers.typescript).toEqual(
            DEFAULT_TS_BLOCK.lspServers.typescript,
        );
    });

    it("preserves other lspServers entries when merging typescript", () => {
        const existing = {
            lspServers: { python: { command: "pylsp", args: [] } },
        };
        const { next, changed } = mergeLspConfig(existing);
        expect(changed).toBe(true);
        expect((next as any).lspServers.python).toEqual({ command: "pylsp", args: [] });
        expect((next as any).lspServers.typescript).toBeDefined();
    });

    it("leaves file untouched when typescript already present", () => {
        const existing = {
            lspServers: {
                typescript: { command: "tsserver-custom", args: ["--my-flag"] },
            },
        };
        const { next, changed } = mergeLspConfig(existing);
        expect(changed).toBe(false);
        expect(next).toBe(existing);
    });

    it("preserves unknown top-level keys", () => {
        const existing = {
            version: 2,
            lspServers: {},
            customExtension: { foo: "bar" },
        };
        const { next } = mergeLspConfig(existing);
        expect((next as any).version).toBe(2);
        expect((next as any).customExtension).toEqual({ foo: "bar" });
    });
});
```

**Step 2: Run tests to verify they fail**

```
npm run test -w @debug-gui/server -- lspInit
```

Expected: ALL FAIL with "Cannot find module '../src/lspInit.js'".

**Step 3: Write minimal implementation**

Write `packages/debug-gui/server/src/lspInit.ts`:

```ts
export const DEFAULT_TS_BLOCK = {
    lspServers: {
        typescript: {
            command: "typescript-language-server",
            args: ["--stdio"],
            fileExtensions: {
                ".ts": "typescript",
                ".tsx": "typescriptreact",
                ".js": "javascript",
                ".jsx": "javascriptreact",
                ".mjs": "javascript",
                ".cjs": "javascript",
                ".mts": "typescript",
                ".cts": "typescript",
            },
        },
    },
} as const;

export interface MergeResult {
    next: unknown;
    changed: boolean;
}

export function mergeLspConfig(existing: unknown): MergeResult {
    if (existing === null || typeof existing !== "object") {
        return { next: structuredClone(DEFAULT_TS_BLOCK), changed: true };
    }
    const obj = existing as Record<string, unknown>;
    const servers = (obj.lspServers ?? {}) as Record<string, unknown>;
    if (servers.typescript) {
        return { next: existing, changed: false };
    }
    return {
        next: {
            ...obj,
            lspServers: {
                ...servers,
                typescript: structuredClone(DEFAULT_TS_BLOCK.lspServers.typescript),
            },
        },
        changed: true,
    };
}
```

**Step 4: Run tests to verify they pass**

```
npm run test -w @debug-gui/server -- lspInit
```

Expected: 5 PASS.

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/lspInit.ts packages/debug-gui/server/test/lspInit.test.ts
git commit -m "feat(debug-gui): pure mergeLspConfig helper + default TS block"
```

---

## Task 2: Binary probe via `--version` spawn

**Files:**
- Modify: `packages/debug-gui/server/src/lspInit.ts` (append)
- Modify: `packages/debug-gui/server/test/lspInit.test.ts` (append)

**Step 1: Write the failing tests**

Append to `lspInit.test.ts`:

```ts
import { probeBinary } from "../src/lspInit.js";

describe("probeBinary", () => {
    it("returns ok when command exits 0", async () => {
        const result = await probeBinary("node", ["--version"], 1500);
        expect(result.kind).toBe("ok");
    });

    it("returns missing when command does not exist", async () => {
        const result = await probeBinary("definitely-not-a-real-binary-xyz", ["--version"], 1500);
        expect(result.kind).toBe("missing");
    });

    it("returns broken with stderr tail when command exits non-zero", async () => {
        // `node -e "process.stderr.write('boom'); process.exit(1)"` reliably exits 1 on every platform.
        const result = await probeBinary("node", ["-e", "process.stderr.write('boom'); process.exit(1)"], 1500);
        expect(result.kind).toBe("broken");
        if (result.kind === "broken") {
            expect(result.stderrTail).toContain("boom");
        }
    });

    it("returns broken on timeout", async () => {
        const result = await probeBinary("node", ["-e", "setTimeout(() => {}, 5000)"], 200);
        expect(result.kind).toBe("broken");
        if (result.kind === "broken") {
            expect(result.stderrTail).toContain("timeout");
        }
    });
});
```

**Step 2: Run tests to verify they fail**

```
npm run test -w @debug-gui/server -- lspInit
```

Expected: 4 new tests FAIL with "Cannot find export 'probeBinary'".

**Step 3: Write minimal implementation**

Append to `lspInit.ts`:

```ts
import { spawn } from "node:child_process";

export type ProbeResult =
    | { kind: "ok" }
    | { kind: "missing" }
    | { kind: "broken"; stderrTail: string };

const STDERR_TAIL_BYTES = 2048;

export function probeBinary(cmd: string, args: string[], timeoutMs: number): Promise<ProbeResult> {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (r: ProbeResult) => {
            if (settled) return;
            settled = true;
            resolve(r);
        };

        let stderr = "";
        // Windows + npm shims need shell:true so `.cmd` resolves on PATH.
        const child = spawn(cmd, args, { shell: process.platform === "win32" });

        const timer = setTimeout(() => {
            child.kill();
            settle({ kind: "broken", stderrTail: "timeout after " + timeoutMs + "ms" });
        }, timeoutMs);

        child.on("error", (err: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            if (err.code === "ENOENT") return settle({ kind: "missing" });
            settle({ kind: "broken", stderrTail: err.message });
        });

        child.stderr?.on("data", (chunk: Buffer) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
        });

        child.on("exit", (code) => {
            clearTimeout(timer);
            if (code === 0) return settle({ kind: "ok" });
            settle({ kind: "broken", stderrTail: stderr || `exited with code ${code}` });
        });
    });
}
```

**Step 4: Run tests to verify they pass**

```
npm run test -w @debug-gui/server -- lspInit
```

Expected: 9 PASS total.

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/lspInit.ts packages/debug-gui/server/test/lspInit.test.ts
git commit -m "feat(debug-gui): probe LSP binary via --version with timeout"
```

---

## Task 3: `ensureLspConfig` orchestrator with DI for fs + probe

**Files:**
- Modify: `packages/debug-gui/server/src/lspInit.ts` (append)
- Modify: `packages/debug-gui/server/test/lspInit.test.ts` (append)

**Step 1: Write the failing tests**

Append to `lspInit.test.ts`:

```ts
import { ensureLspConfig } from "../src/lspInit.js";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTempCwd(): string {
    return mkdtempSync(join(tmpdir(), "lsp-init-"));
}

describe("ensureLspConfig", () => {
    it("returns missing without writing config when binary is absent", async () => {
        const cwd = makeTempCwd();
        const result = await ensureLspConfig(cwd, {
            probe: async () => ({ kind: "missing" }),
        });
        expect(result.status).toBe("missing");
        expect(result.installCmd).toContain("typescript-language-server");
        expect(existsSync(join(cwd, ".github/lsp.json"))).toBe(false);
    });

    it("returns broken with stderrTail without writing config", async () => {
        const cwd = makeTempCwd();
        const result = await ensureLspConfig(cwd, {
            probe: async () => ({ kind: "broken", stderrTail: "version mismatch" }),
        });
        expect(result.status).toBe("broken");
        expect(result.stderrTail).toBe("version mismatch");
        expect(result.installCmd).toBeDefined();
        expect(existsSync(join(cwd, ".github/lsp.json"))).toBe(false);
    });

    it("creates .github/lsp.json when missing", async () => {
        const cwd = makeTempCwd();
        const result = await ensureLspConfig(cwd, { probe: async () => ({ kind: "ok" }) });
        expect(result.status).toBe("ok");
        const written = JSON.parse(readFileSync(join(cwd, ".github/lsp.json"), "utf8"));
        expect(written.lspServers.typescript.command).toBe("typescript-language-server");
    });

    it("merges typescript into existing config without touching other keys", async () => {
        const cwd = makeTempCwd();
        mkdirSync(join(cwd, ".github"));
        writeFileSync(
            join(cwd, ".github/lsp.json"),
            JSON.stringify({ lspServers: { python: { command: "pylsp", args: [] } } }, null, 2),
        );
        const result = await ensureLspConfig(cwd, { probe: async () => ({ kind: "ok" }) });
        expect(result.status).toBe("ok");
        const written = JSON.parse(readFileSync(join(cwd, ".github/lsp.json"), "utf8"));
        expect(written.lspServers.python).toEqual({ command: "pylsp", args: [] });
        expect(written.lspServers.typescript).toBeDefined();
    });

    it("does not modify file when typescript entry already exists", async () => {
        const cwd = makeTempCwd();
        mkdirSync(join(cwd, ".github"));
        const path = join(cwd, ".github/lsp.json");
        writeFileSync(
            path,
            JSON.stringify({ lspServers: { typescript: { command: "custom-tsserver" } } }, null, 2),
        );
        const mtimeBefore = statSync(path).mtimeMs;
        // Wait a tick so a write would change mtime measurably.
        await new Promise((r) => setTimeout(r, 20));
        const result = await ensureLspConfig(cwd, { probe: async () => ({ kind: "ok" }) });
        expect(result.status).toBe("ok");
        expect(statSync(path).mtimeMs).toBe(mtimeBefore);
        const written = JSON.parse(readFileSync(path, "utf8"));
        expect(written.lspServers.typescript.command).toBe("custom-tsserver");
    });

    it("returns config-invalid when existing JSON is malformed", async () => {
        const cwd = makeTempCwd();
        mkdirSync(join(cwd, ".github"));
        writeFileSync(join(cwd, ".github/lsp.json"), "{ this is not json");
        const result = await ensureLspConfig(cwd, { probe: async () => ({ kind: "ok" }) });
        expect(result.status).toBe("config-invalid");
        // File is left untouched.
        expect(readFileSync(join(cwd, ".github/lsp.json"), "utf8")).toBe("{ this is not json");
    });
});
```

**Step 2: Run tests to verify they fail**

```
npm run test -w @debug-gui/server -- lspInit
```

Expected: 6 new tests FAIL with "Cannot find export 'ensureLspConfig'".

**Step 3: Write minimal implementation**

Append to `lspInit.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface LspInitResult {
    status: "ok" | "missing" | "broken" | "config-invalid" | "fs-error";
    message?: string;
    installCmd?: string;
    stderrTail?: string;
}

export interface EnsureLspConfigOpts {
    probe?: (cmd: string, args: string[], timeoutMs: number) => Promise<ProbeResult>;
}

const INSTALL_CMD = "npm install -g typescript-language-server";

export async function ensureLspConfig(cwd: string, opts: EnsureLspConfigOpts = {}): Promise<LspInitResult> {
    const probe = opts.probe ?? probeBinary;
    const probed = await probe("typescript-language-server", ["--version"], 1500);

    if (probed.kind === "missing") {
        return { status: "missing", installCmd: INSTALL_CMD };
    }
    if (probed.kind === "broken") {
        return { status: "broken", installCmd: INSTALL_CMD, stderrTail: probed.stderrTail };
    }

    const configDir = join(cwd, ".github");
    const configPath = join(configDir, "lsp.json");

    let existing: unknown = null;
    try {
        const raw = await readFile(configPath, "utf8");
        try {
            existing = JSON.parse(raw);
        } catch {
            return {
                status: "config-invalid",
                message: `${configPath} is not valid JSON; left untouched`,
            };
        }
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            return { status: "fs-error", message: (err as Error).message };
        }
        // File does not exist yet — fall through with existing=null.
    }

    const merged = mergeLspConfig(existing);
    if (!merged.changed) return { status: "ok" };

    try {
        await mkdir(configDir, { recursive: true });
        await writeFile(configPath, JSON.stringify(merged.next, null, 2) + "\n", "utf8");
        return { status: "ok" };
    } catch (err) {
        return { status: "fs-error", message: (err as Error).message };
    }
}
```

**Step 4: Run tests to verify they pass**

```
npm run test -w @debug-gui/server -- lspInit
```

Expected: 15 PASS total.

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/lspInit.ts packages/debug-gui/server/test/lspInit.test.ts
git commit -m "feat(debug-gui): ensureLspConfig orchestrator with merge + fs error handling"
```

---

## Task 4: Server `messages.ts` — add `lsp/warning` event

**Files:**
- Modify: `packages/debug-gui/server/src/messages.ts`

**Step 1: Inspect the union**

Open `packages/debug-gui/server/src/messages.ts` and locate the `ServerEvent` union (line 3-26).

**Step 2: Modify to add `LspWarning` and event variant**

Insert after line 1 (the import line):

```ts
export interface LspWarning {
    kind: "missing" | "broken" | "config-invalid" | "fs-error";
    message?: string;
    installCmd?: string;
    stderrTail?: string;
}
```

Add a new variant to the `ServerEvent` union right before `| { type: "error"; message: string };`:

```ts
    | { type: "lsp/warning"; warning: LspWarning }
```

**Step 3: Build to verify types compile**

```
npm run build -w @debug-gui/server
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git add packages/debug-gui/server/src/messages.ts
git commit -m "feat(debug-gui): lsp/warning ServerEvent variant"
```

---

## Task 5: Wire `ensureLspConfig` into `index.ts` + `--experimental` flag

**Files:**
- Modify: `packages/debug-gui/server/src/index.ts` (around line 90 and 106)

**Step 1: Add import**

Near the other `./` imports at the top of `index.ts`:

```ts
import { ensureLspConfig, type LspInitResult } from "./lspInit.js";
import type { LspWarning } from "./messages.js";
```

**Step 2: Modify `main()` to run LSP init at startup**

Inside `main(cwd, port)`, before the `WebSocketServer` is created (around line 90), insert:

```ts
const lspResult = await ensureLspConfig(cwd);
const lspWarning: LspWarning | null =
    lspResult.status === "ok"
        ? null
        : {
              kind: lspResult.status,
              message: lspResult.message,
              installCmd: lspResult.installCmd,
              stderrTail: lspResult.stderrTail,
          };
console.log(`[lsp] ${lspResult.status}${lspResult.message ? `: ${lspResult.message}` : ""}`);
```

**Step 3: Broadcast on first WS connect**

In the `wss.on("connection", (ws) => { ... })` handler (around line 92-97), after the existing `ws.send` for `init`, add:

```ts
if (lspWarning) {
    ws.send(JSON.stringify({ type: "lsp/warning", warning: lspWarning }));
}
```

**Step 4: Pass `--experimental` to CopilotClient**

Modify line 106 from:

```ts
const copilot = new CopilotClient({ sessionIdleTimeoutSeconds: 1800 });
```

to:

```ts
const copilot = new CopilotClient({
    sessionIdleTimeoutSeconds: 1800,
    cliArgs: ["--experimental"],
});
```

**Step 5: Build + run server tests to verify nothing regressed**

```
npm run build -w @debug-gui/server && npm run test -w @debug-gui/server
```

Expected: Build clean, all tests pass.

**Step 6: Commit**

```bash
git add packages/debug-gui/server/src/index.ts
git commit -m "feat(debug-gui): wire LSP init at startup, pass --experimental to copilot"
```

---

## Task 6: Frontend store — `lspWarning` field + reducer

**Files:**
- Modify: `packages/debug-gui/web/src/state/store.ts`
- Modify: `packages/debug-gui/web/src/state/store.test.ts`

**Step 1: Write failing test**

Append to `web/src/state/store.test.ts`:

```ts
describe("lsp/warning event", () => {
    it("populates lspWarning from event", () => {
        const { result } = renderHook(() => useStore());
        act(() => {
            result.current.applyEvent({
                type: "lsp/warning",
                warning: {
                    kind: "missing",
                    installCmd: "npm install -g typescript-language-server",
                },
            });
        });
        expect(result.current.lspWarning).toEqual({
            kind: "missing",
            installCmd: "npm install -g typescript-language-server",
        });
    });

    it("dismissLspWarning clears it", () => {
        const { result } = renderHook(() => useStore());
        act(() => {
            result.current.applyEvent({
                type: "lsp/warning",
                warning: { kind: "broken", stderrTail: "boom" },
            });
        });
        expect(result.current.lspWarning).not.toBeNull();
        act(() => result.current.dismissLspWarning());
        expect(result.current.lspWarning).toBeNull();
    });
});
```

(If your existing store.test.ts does not already import `renderHook` and `act`, add `import { renderHook, act } from "@testing-library/react";` at the top.)

**Step 2: Run test to verify it fails**

```
npm run test -w @debug-gui/web -- store
```

Expected: 2 new tests FAIL — `lspWarning` and `dismissLspWarning` are undefined.

**Step 3: Update store**

In `web/src/state/store.ts`:

a. Add the `LspWarning` shape near the other interfaces (after `Prompt`):

```ts
export interface LspWarning {
    kind: "missing" | "broken" | "config-invalid" | "fs-error";
    message?: string;
    installCmd?: string;
    stderrTail?: string;
}
```

b. Add fields to the `Store` interface:

```ts
    lspWarning: LspWarning | null;
    dismissLspWarning: () => void;
```

c. Initialize in the `create<Store>` body, alongside other defaults (e.g. after `agentActivity: ""`):

```ts
    lspWarning: null,
```

d. Inside `applyEvent`, before the final `return {};`, add a handler:

```ts
            if (e.type === "lsp/warning") {
                return { lspWarning: e.warning as LspWarning };
            }
```

e. After the `selectSuite` definition (still inside `create`), add:

```ts
    dismissLspWarning: () => set({ lspWarning: null }),
```

**Step 4: Run tests to verify they pass**

```
npm run test -w @debug-gui/web -- store
```

Expected: All store tests pass.

**Step 5: Commit**

```bash
git add packages/debug-gui/web/src/state/store.ts packages/debug-gui/web/src/state/store.test.ts
git commit -m "feat(debug-gui): lspWarning store field + dismiss action"
```

---

## Task 7: `LspWarningModal` component

**Files:**
- Create: `packages/debug-gui/web/src/components/LspWarningModal.tsx`
- Create: `packages/debug-gui/web/src/components/LspWarningModal.test.tsx`

**Step 1: Write failing tests**

Create `web/src/components/LspWarningModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LspWarningModal } from "./LspWarningModal";

describe("LspWarningModal", () => {
    it("renders nothing when warning is null", () => {
        const { container } = render(<LspWarningModal warning={null} onDismiss={() => {}} />);
        expect(container.firstChild).toBeNull();
    });

    it("renders missing variant with install command", () => {
        render(
            <LspWarningModal
                warning={{ kind: "missing", installCmd: "npm install -g typescript-language-server" }}
                onDismiss={() => {}}
            />,
        );
        expect(screen.getByText(/LSP server not installed/i)).toBeInTheDocument();
        expect(screen.getByText(/npm install -g typescript-language-server/)).toBeInTheDocument();
        expect(screen.getByText(/Restart debug-gui after fixing/i)).toBeInTheDocument();
    });

    it("renders broken variant with stderr tail", () => {
        render(
            <LspWarningModal
                warning={{ kind: "broken", stderrTail: "EACCES: permission denied", installCmd: "npm install -g typescript-language-server" }}
                onDismiss={() => {}}
            />,
        );
        expect(screen.getByText(/LSP server failed to start/i)).toBeInTheDocument();
        expect(screen.getByText(/EACCES: permission denied/)).toBeInTheDocument();
    });

    it("calls onDismiss when Dismiss is clicked", () => {
        const onDismiss = vi.fn();
        render(
            <LspWarningModal warning={{ kind: "missing", installCmd: "x" }} onDismiss={onDismiss} />,
        );
        fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
        expect(onDismiss).toHaveBeenCalledOnce();
    });
});
```

**Step 2: Run test to verify it fails**

```
npm run test -w @debug-gui/web -- LspWarningModal
```

Expected: All FAIL with "Cannot find module './LspWarningModal'".

**Step 3: Write component**

Create `web/src/components/LspWarningModal.tsx`:

```tsx
import { EfButton, EfDialog } from "../ui";
import type { LspWarning } from "../state/store";

const TITLES: Record<LspWarning["kind"], string> = {
    missing: "LSP server not installed",
    broken: "LSP server failed to start",
    "config-invalid": ".github/lsp.json is invalid JSON",
    "fs-error": "Could not write LSP config",
};

const BODIES: Record<LspWarning["kind"], string> = {
    missing:
        "The agent will work without precise code intelligence (find-references, definitions, diagnostics) until you install a TypeScript LSP server.",
    broken:
        "typescript-language-server is on PATH but failed when invoked with --version. The agent will run without LSP support.",
    "config-invalid":
        "Your existing .github/lsp.json could not be parsed as JSON. debug-gui left the file untouched. Fix the syntax and restart.",
    "fs-error":
        "debug-gui could not write .github/lsp.json (likely a filesystem permission issue). The agent will run without LSP support.",
};

export interface LspWarningModalProps {
    warning: LspWarning | null;
    onDismiss: () => void;
}

export function LspWarningModal({ warning, onDismiss }: LspWarningModalProps) {
    if (!warning) return null;
    const title = TITLES[warning.kind];
    const body = warning.message ?? BODIES[warning.kind];
    return (
        <EfDialog opened header={title} onCancel={onDismiss}>
            <div className="flex flex-col gap-3 max-w-xl">
                <p className="text-sm">{body}</p>
                {warning.installCmd ? (
                    <pre className="text-xs bg-black/40 p-2 rounded select-all overflow-x-auto">
                        {warning.installCmd}
                    </pre>
                ) : null}
                {warning.stderrTail ? (
                    <pre className="text-xs bg-black/40 p-2 rounded max-h-40 overflow-auto">
                        {warning.stderrTail}
                    </pre>
                ) : null}
                <p className="text-xs opacity-70">
                    Restart debug-gui after fixing to retry detection.
                </p>
                <div className="flex justify-end">
                    <EfButton onClick={onDismiss}>Dismiss</EfButton>
                </div>
            </div>
        </EfDialog>
    );
}
```

**Step 4: Run tests to verify they pass**

```
npm run test -w @debug-gui/web -- LspWarningModal
```

Expected: 4 PASS.

**Step 5: Commit**

```bash
git add packages/debug-gui/web/src/components/LspWarningModal.tsx packages/debug-gui/web/src/components/LspWarningModal.test.tsx
git commit -m "feat(debug-gui): LspWarningModal component with kind-specific copy"
```

---

## Task 8: Mount modal in `App.tsx`

**Files:**
- Modify: `packages/debug-gui/web/src/App.tsx`

**Step 1: Add import**

Near the other component imports:

```ts
import { LspWarningModal } from "./components/LspWarningModal";
```

**Step 2: Read store fields in component body**

Inside `App()`, alongside the other `useStore` selectors:

```ts
const lspWarning = useStore((s) => s.lspWarning);
const dismissLspWarning = useStore((s) => s.dismissLspWarning);
```

**Step 3: Render modal at root**

Inside the top-level JSX returned by `App` (sibling of the existing top-level wrapper, or just before its closing tag), add:

```tsx
<LspWarningModal warning={lspWarning} onDismiss={dismissLspWarning} />
```

**Step 4: Verify build + smoke tests**

```
npm run build -w @debug-gui/web && npm run test -w @debug-gui/web
```

Expected: Build clean, all tests pass.

**Step 5: Commit**

```bash
git add packages/debug-gui/web/src/App.tsx
git commit -m "feat(debug-gui): mount LspWarningModal at app root"
```

---

## Task 9: Smoke test surface

**Files:**
- Modify: `packages/debug-gui/test/smoke.sh` (only if it currently asserts on `/api/init`; otherwise skip).

**Step 1: Inspect current smoke test**

```bash
cat packages/debug-gui/test/smoke.sh
```

If the script already curls `/api/init` and pipes through `jq`, append a check that the response includes a non-undefined `lspStatus` field. The wiring is: `/api/init` handler in `index.ts` should also return `lsp: lspResult.status` so the smoke test can assert on it.

**Step 2: Add `lsp` to `/api/init` response**

In `index.ts`, locate the `app.get("/api/init", ...)` handler. Add `lsp: lspResult.status` to the JSON it returns.

**Step 3: Update smoke test**

Add a line like:

```bash
echo "$INIT" | jq -e '.lsp == "ok" or .lsp == "missing" or .lsp == "broken" or .lsp == "config-invalid" or .lsp == "fs-error"' >/dev/null \
    || { echo "FAIL: /api/init missing lsp field"; exit 1; }
```

**Step 4: Run smoke test**

```bash
bash packages/debug-gui/test/smoke.sh
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/debug-gui/server/src/index.ts packages/debug-gui/test/smoke.sh
git commit -m "test(debug-gui): assert /api/init exposes lsp status in smoke"
```

---

## Task 10: Manual verification + final integration check

**Steps (no commit unless something needs fixing):**

1. **Setup A — no LSP installed**

   ```bash
   bun uninstall -g typescript-language-server 2>/dev/null || true
   npm uninstall -g typescript-language-server 2>/dev/null || true
   cd /tmp && mkdir lsp-smoke && cd lsp-smoke && git init
   ```

   Launch debug-gui pointed at `lsp-smoke`. Open browser to `http://localhost:5555`.

   **Expected:** Modal appears: "LSP server not installed" with `npm install -g typescript-language-server` install command and Dismiss button. Modal can be dismissed; the rest of the UI is interactive. `.github/lsp.json` was NOT created.

2. **Setup B — install + restart**

   ```bash
   bun install -g typescript-language-server
   ```

   Stop and restart debug-gui.

   **Expected:** No modal appears. `.github/lsp.json` exists in `lsp-smoke` with the default TS block.

3. **Setup C — preserve existing config**

   Edit `lsp-smoke/.github/lsp.json` to:

   ```json
   {
     "lspServers": {
       "typescript": { "command": "custom-tsserver", "args": [] }
     }
   }
   ```

   Restart debug-gui.

   **Expected:** File contents unchanged (still has `custom-tsserver`).

4. **Setup D — partial config gets merged**

   Replace `.github/lsp.json` with:

   ```json
   { "lspServers": { "python": { "command": "pylsp", "args": [] } } }
   ```

   Restart debug-gui.

   **Expected:** File now also contains `lspServers.typescript` (default block); `python` entry preserved.

5. **Setup E — invalid JSON**

   Replace `.github/lsp.json` with `{ broken json`.

   Restart debug-gui.

   **Expected:** Modal appears: "`.github/lsp.json` is invalid JSON". File contents unchanged.

6. **Run a real walkthrough** in any TS test repo with the agent; confirm via the agent activity log that it issues `/lsp test typescript` or otherwise references LSP.

If all 6 steps pass: nothing to commit, the feature is verified end-to-end.

---

## Task 11: Final tidy + branch ready for PR

**Step 1: Update `MEMORY.md` index** (only if a relevant memory was added during implementation; otherwise skip).

**Step 2: Run the full test matrix one last time**

```bash
npm run test -w @debug-gui/server && npm run test -w @debug-gui/web && bash packages/debug-gui/test/smoke.sh
```

Expected: All green.

**Step 3: Branch summary**

```bash
git log --oneline main..HEAD
```

Expected output: 8 commits (one per Task 1–8) on top of design doc.

**Step 4 (optional): Open PR**

When the user says "open PR", follow the standard `gh pr create` flow with the design doc title as the PR title.

---

## Notes for the implementing engineer

- **Do not** hardcode the `typescript-language-server` path — `command` in lsp.json is resolved by Copilot CLI against PATH at session start. If you find yourself wanting to write an absolute path, stop and re-read the design doc's "non-goals" section.
- **Do not** add a `lspWarning` field to `init` in `messages.ts` — the warning rides its own event so the type stays narrow and the reducer stays simple.
- **Do not** auto-install. The popup tells QA what to run; that is the entire UX contract.
- **If a test is flaky** on Windows for the spawn timeout case, bump the timeout to 500ms — Windows process spawn jitter can be 100-200 ms cold.
- **Idempotency is non-negotiable.** Task 3's "no-op when typescript exists" test is the contract: server can be restarted any number of times without dirtying the user's config.
