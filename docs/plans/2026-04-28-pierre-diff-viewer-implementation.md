# Pierre Diff Viewer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `react-diff-viewer-continued` inside `DiffView.tsx` with `@pierre/diffs` so the agent's edit-suggestion surface gets a polished GitHub-PR-style split view, while preserving public props, WS protocol, and existing tests.

**Architecture:** Add `@pierre/diffs` as a single dependency. Mount `<WorkerPoolContextProvider>` once at `main.tsx` so every diff in the tree shares one Web Worker pool for Shiki tokenization. Inside `DiffView.tsx`, use Pierre's `parseDiffFromFile()` (no separate `diff` import) to convert `oldCode`/`newCode` into a `FileDiffMetadata` and render with `<FileDiff>` in `style: "split"`, `theme: "pierre-dark"`. Vitest aliases the worker URL to a no-op stub because jsdom can't run Web Workers.

**Tech Stack:** `@pierre/diffs` ^1.1.19, React 18.3, Vite 5, Vitest 1.6, jsdom 24, refinitiv-ui (existing).

**Companion design doc:** `docs/plans/2026-04-28-pierre-diff-viewer-design.md`

---

## Pre-flight: read these first

- `docs/plans/2026-04-28-pierre-diff-viewer-design.md` — the why; do not re-litigate.
- `packages/debug-gui/web/src/components/DiffView.tsx` — current 36-line component to replace.
- `packages/debug-gui/web/src/components/DiffView.test.tsx` — must keep passing; do not edit.
- `packages/debug-gui/web/src/components/CodePreview.tsx:65-72` — `languageFromPath()` whose mapping we mirror but extended for Pierre's `SupportedLanguages`.
- `packages/debug-gui/web/src/main.tsx` — provider mount point.
- `packages/debug-gui/web/vite.config.ts` — Vitest worker alias goes here.
- `packages/debug-gui/web/package.json` — dependency edits.
- `CLAUDE.md` — repo conventions; **never** read `architect.md`.

## Conventions for every task

- After every implementation step, run the affected test command and confirm green before committing.
- Commit after each task. Use Conventional Commits prefix `feat(debug-gui):`, `chore(debug-gui):`, `test(debug-gui):`, etc.
- Use `npm` from the repo root (workspaces). Don't `cd` into `packages/debug-gui/web/`.
- All commits should include the standard `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- Never run `npm run build` then claim success — the runtime path matters; smoke-test in browser when worker plumbing changes.

---

## Task 1 — Add `@pierre/diffs` dependency

**Files:**
- Modify: `packages/debug-gui/web/package.json`
- Modify: `package-lock.json` (top-level — auto-updated by npm)

**Step 1: Add the dep**

Run from repo root:

```bash
npm install @pierre/diffs@^1.1.19 -w @debug-gui/web --save
```

Expected: package added under `dependencies` in `packages/debug-gui/web/package.json` between `prism-react-renderer` and `react`.

**Step 2: Verify install**

Run:

```bash
node -e "require.resolve('@pierre/diffs/package.json', {paths: ['packages/debug-gui/web']})"
```

Expected: prints an absolute path; no throw.

**Step 3: Spot-check the React entry resolves**

Run:

```bash
node -e "require.resolve('@pierre/diffs/react', {paths: ['packages/debug-gui/web']})"
```

Expected: prints an absolute path. If it throws (`ERR_PACKAGE_PATH_NOT_EXPORTED` or similar), the export-conditions are misconfigured for CJS resolution; switch to `node --input-type=module -e "import('@pierre/diffs/react').then(m => console.log(Object.keys(m).slice(0,5)))"` from inside `packages/debug-gui/web`.

**Step 4: Commit**

```bash
git add packages/debug-gui/web/package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(debug-gui): add @pierre/diffs dependency

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Vitest stub for the worker URL

Set this up **before** importing `@pierre/diffs` from any source file. Otherwise Task 4's first test run will explode with "Worker is not defined" or similar.

**Files:**
- Create: `packages/debug-gui/web/src/test-stubs/pierre-worker-stub.ts`
- Modify: `packages/debug-gui/web/vite.config.ts`

**Step 1: Create the stub**

File: `packages/debug-gui/web/src/test-stubs/pierre-worker-stub.ts`

Contents — copy verbatim:

```ts
// Vitest runs in jsdom which lacks Web Workers. Pierre's portable worker URL
// is aliased to this file so the import resolves; the empty data-URL default
// export is what `new URL(...).href` will see, and FileDiff in the test env
// just doesn't spin up a real worker.
export default "data:text/javascript,";
```

**Step 2: Add the alias to `vite.config.ts`**

Replace the file contents with:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5555,
        proxy: {
            "/api": "http://localhost:5556",
            "/ws": { target: "ws://localhost:5556", ws: true },
        },
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./src/test-setup.ts"],
        alias: {
            "@pierre/diffs/worker/worker-portable.js":
                "/src/test-stubs/pierre-worker-stub.ts",
        },
    },
});
```

The alias only applies inside `test:` so production builds still pull the real worker.

**Step 3: Commit**

```bash
git add packages/debug-gui/web/src/test-stubs/pierre-worker-stub.ts \
        packages/debug-gui/web/vite.config.ts
git commit -m "$(cat <<'EOF'
test(debug-gui): stub @pierre/diffs worker URL for vitest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Mount `<WorkerPoolContextProvider>` at the app root

**Files:**
- Modify: `packages/debug-gui/web/src/main.tsx`

**Step 1: Write a smoke test**

Create `packages/debug-gui/web/src/main.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";

describe("WorkerPoolContextProvider import", () => {
    it("can be imported and mounted with no children", () => {
        const html = renderToString(
            <WorkerPoolContextProvider poolOptions={{ poolSize: 1 }}>
                <span data-test="ok" />
            </WorkerPoolContextProvider>,
        );
        expect(html).toContain("data-test=\"ok\"");
    });
});
```

Run:

```bash
npm run test -w @debug-gui/web -- main.test
```

Expected: PASS. (If it fails on import, the alias from Task 2 isn't resolving — fix before continuing.)

**Step 2: Wrap the app**

Replace `main.tsx` contents:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import App from "./App";
import "./ui";
import "./index.css";

const workerUrl = new URL(
    "@pierre/diffs/worker/worker-portable.js",
    import.meta.url,
).href;

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <WorkerPoolContextProvider
            poolOptions={{ poolSize: 2, workerUrl }}
            highlighterOptions={{
                themes: ["pierre-dark"],
                langs: ["javascript", "typescript", "tsx", "jsx", "json"],
            }}
        >
            <App />
        </WorkerPoolContextProvider>
    </React.StrictMode>,
);
```

**Step 3: Run the full web test suite**

```bash
npm run test -w @debug-gui/web
```

Expected: all tests pass (the new smoke test plus all existing).

**Step 4: Build the web bundle to confirm Vite emits the worker chunk**

```bash
npm run build -w @debug-gui/web
```

Expected: build succeeds; the `dist/assets/` listing includes a worker chunk file (filename will look like `worker-portable.<hash>.js`). If Vite errors on `new URL(...)`, the symlink-via-workspaces resolution failed — fall back to the workaround in the design doc (copy worker into `web/public/` and reference by relative URL).

**Step 5: Commit**

```bash
git add packages/debug-gui/web/src/main.tsx \
        packages/debug-gui/web/src/main.test.tsx
git commit -m "$(cat <<'EOF'
feat(debug-gui): mount @pierre/diffs WorkerPoolContextProvider at app root

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Rewrite `DiffView.tsx` to use `<FileDiff>`

**Files:**
- Modify: `packages/debug-gui/web/src/components/DiffView.tsx`
- Touch (verify-only): `packages/debug-gui/web/src/components/DiffView.test.tsx`

The existing test asserts the buttons fire `onApprove`/`onReject` — that contract must still hold.

**Step 1: Run existing tests to confirm baseline green**

```bash
npm run test -w @debug-gui/web -- DiffView
```

Expected: 1 passing test ("fires onApprove/onReject").

**Step 2: Rewrite `DiffView.tsx`**

Replace the entire file with:

```tsx
import { useMemo } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import type { SupportedLanguages } from "@pierre/diffs";
import { EfButton, EfPanel } from "../ui";

// Map a file path to one of @pierre/diffs' SupportedLanguages. Unknown
// extensions render as "text" — Pierre still draws the diff, just without
// syntax colours.
function pierreLanguageFor(path: string): SupportedLanguages {
    const lower = path.toLowerCase();
    if (lower.endsWith(".tsx")) return "tsx";
    if (lower.endsWith(".jsx")) return "jsx";
    if (lower.endsWith(".ts")) return "typescript";
    if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
        return "javascript";
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".md")) return "markdown";
    return "text";
}

export function DiffView({
    file,
    oldCode,
    newCode,
    onApprove,
    onReject,
}: {
    file: string;
    oldCode: string;
    newCode: string;
    onApprove: () => void;
    onReject: () => void;
}) {
    const language = pierreLanguageFor(file);
    const fileDiff = useMemo(
        () =>
            parseDiffFromFile(
                { name: file, contents: oldCode, language },
                { name: file, contents: newCode, language },
            ),
        [file, oldCode, newCode, language],
    );

    return (
        <EfPanel style={{ display: "block" }}>
            <div
                className="text-xs p-2 opacity-70"
                style={{ borderBottom: "1px solid var(--ef-border-color)" }}
            >
                {file}
            </div>
            <FileDiff
                fileDiff={fileDiff}
                options={{ theme: "pierre-dark", style: "split" }}
            />
            <div
                className="p-2 flex gap-2 justify-end"
                style={{ borderTop: "1px solid var(--ef-border-color)" }}
            >
                <EfButton onClick={onReject} style={{ color: "var(--ef-error)" }}>
                    Reject
                </EfButton>
                <EfButton cta onClick={onApprove}>
                    Approve
                </EfButton>
            </div>
        </EfPanel>
    );
}
```

**Step 3: Re-run the existing test**

```bash
npm run test -w @debug-gui/web -- DiffView
```

Expected: still 1 passing test. If it fails because `<FileDiff>` blows up under jsdom, set `disableWorkerPool={true}` on `<FileDiff>` when `import.meta.env.MODE === "test"` — guarded fallback only, not a permanent change.

**Step 4: Run full suite**

```bash
npm run test -w @debug-gui/web
```

Expected: all green.

**Step 5: Type-check**

```bash
npx tsc -b packages/debug-gui/web --noEmit
```

Expected: no errors. Pay special attention to `SupportedLanguages` import — Pierre re-exports it from the main entry. If TypeScript can't find the type, drop the explicit annotation and let inference handle it (the function will return a string union from the literals).

**Step 6: Commit**

```bash
git add packages/debug-gui/web/src/components/DiffView.tsx
git commit -m "$(cat <<'EOF'
feat(debug-gui): swap DiffView to @pierre/diffs FileDiff (split view)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Drop the obsolete dependency

**Files:**
- Modify: `packages/debug-gui/web/package.json`

**Step 1: Confirm no remaining imports**

Use the Grep tool with `pattern: "react-diff-viewer-continued"`, `path: "packages/debug-gui"`. Expected: zero matches in source `.ts`/`.tsx` files (only `package.json` and `package-lock.json`).

**Step 2: Uninstall**

```bash
npm uninstall react-diff-viewer-continued -w @debug-gui/web
```

**Step 3: Build + test**

```bash
npm run build -w @debug-gui/web && npm run test -w @debug-gui/web
```

Expected: both succeed.

**Step 4: Commit**

```bash
git add packages/debug-gui/web/package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(debug-gui): remove react-diff-viewer-continued

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Browser smoke test with a real pending diff

This is the verification that actually proves the feature works. Tests + builds passed, but the worker plumbing only runs in a browser. Per `CLAUDE.md`: "type checking and test suites verify code correctness, not feature correctness."

**Files:** none modified — purely manual + screenshot.

**Step 1: Start the debug-gui server**

From repo root:

```bash
npm run build -w @debug-gui/server && npm run build -w @debug-gui/web
node packages/debug-gui/bin/debug-gui.js
```

Expected: server logs a port (default 5555). Open the URL in a browser.

**Step 2: Trigger a pending diff**

The fastest path to a `pendingDiff` without running a real walkthrough session: in the running browser, open DevTools and dispatch a fake event into the Zustand store:

```js
// DevTools console
const { useStore } = window;
useStore?.setState?.({
    pendingDiff: {
        reqId: "smoke-1",
        file: "test/example.ts",
        oldCode: "function greet(name) {\n  return 'Hello ' + name;\n}\n",
        newCode: "function greet(name: string): string {\n  return `Hello ${name}`;\n}\n",
    },
});
```

If `useStore` isn't on `window`, expose it temporarily by adding `(window as any).useStore = useStore;` to `state/store.ts` for the smoke test, then revert before committing. (Don't commit the window assignment.)

**Step 3: Visually verify**

- Diff renders in a split (side-by-side) layout.
- Old code on the left has the deleted line struck/removed; new code on the right has the additions highlighted.
- Syntax colours apply (keywords, strings, type annotations).
- No console errors (worker fetch succeeded).
- Approve / Reject buttons are visible below the diff.

**Step 4: Functional verify**

- Click Reject: pending diff disappears.
- Reset state via DevTools, click Approve: pending diff disappears.
- Open Network tab, confirm worker chunk loaded successfully.

**Step 5: If anything is off**

- Worker 404'd: revisit Task 3 worker URL pattern; fall back to `web/public/` copy.
- No syntax colours: theme/language preload mismatch — confirm `pierre-dark` and the language are in `highlighterOptions`.
- Layout broken: `<EfPanel>` may be clamping width — wrap `<FileDiff>` in a `<div style={{ minWidth: 0, width: "100%" }}>`.

**Step 6: Commit any fixes from Step 5; otherwise no commit needed**

---

## Task 7 — Update `CLAUDE.md` with the new convention

Brief — one bullet under Conventions.

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add bullet**

In the Conventions section, after the `playwright-cli invocation` bullet, add:

```markdown
- **Diff rendering** — agent edit-suggestions render through `@pierre/diffs` (`<FileDiff>` + `parseDiffFromFile`). Worker pool is provided once at `web/src/main.tsx`; do not wrap individual diffs.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: note @pierre/diffs DiffView convention in CLAUDE.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done definition

- `npm run test -w @debug-gui/web` green.
- `npm run build -w @debug-gui/web` succeeds and emits a worker chunk in `dist/assets/`.
- `npx tsc -b packages/debug-gui/web --noEmit` clean.
- Browser smoke test (Task 6) shows split view with syntax highlighting and working buttons.
- `react-diff-viewer-continued` no longer in `web/package.json`.
- `architect.md` was not opened.

## Things to bail out and ask the human about

- Vite cannot resolve `@pierre/diffs/worker/worker-portable.js` via `new URL(...)` in a workspace symlink — design doc lists a `public/` fallback but it changes the deploy story slightly.
- Worker fetch fails inside an LSEG-locked environment because the portable worker reaches for an external URL.
- `parseDiffFromFile` throws at runtime on a payload (signal a Pierre bug — capture the inputs, fall back to `disableWorkerPool` + `style: "stacked"` to see if it's just the split renderer, file an issue).
