# Suite-Switch Confirmation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When QA tries to change selection (`selectedSpec` / `selectedNode`, or clear node) while a run is live, pop a confirm dialog. On confirm, send `{type:"cancel"}` and wait for `state.state` to flip to `idle`/`done` before applying the new selection. Lock the UI between confirm and the cancel landing.

**Architecture:** All new logic is local to `web/src/App.tsx` — two `useState` hooks (`pendingSelection`, `switching`), a `requestSelectionChange` wrapper, an `EfDialog` opened when `pendingSelection !== null`, and a `useEffect` that watches for the cancel landing and applies the pending selection. `TestTree`, `SelectionPanel`, and the server protocol are unchanged. See `docs/plans/2026-05-02-suite-switch-confirm-design.md` for context.

**Tech Stack:** React + TypeScript + Zustand store + Vitest + React Testing Library + refinitiv-ui (`<EfDialog>`, `<EfButton>`, `<Spinner>`).

---

## Pre-flight

**Before starting:** verify the worktree builds clean.

```bash
npm run build -w @debug-gui/web
npm run test -w @debug-gui/web
```

Expected: both succeed with zero failures. If either fails, stop and report — the baseline is broken before any changes.

---

## Task 1: Regression test — idle passthrough still works

This locks in the existing behavior so later tasks can't silently break it.

**Files:**
- Modify: `packages/debug-gui/web/src/App.test.tsx`

**Step 1: Add a regression test inside the existing `describe("App empty-state integration", ...)` or alongside it as a new `describe("App suite-switch confirmation", ...)`. Place at end of file.**

```tsx
describe("App suite-switch confirmation", () => {
    beforeEach(() => {
        // Reset store to a known idle state with two discoverable suites.
        useStore.setState({
            suites: [
                { relPath: "test/a.spec.js", absPath: "/x/a.spec.js" },
                { relPath: "test/b.spec.js", absPath: "/x/b.spec.js" },
            ],
            selectedSpec: "test/a.spec.js",
            selectedNode: null,
            state: { state: "idle" },
            suiteTrees: {},
            config: {},
        });
    });

    it("idle: clicking another suite applies immediately, no dialog", () => {
        render(<App />);
        // Sanity: dialog not present.
        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("test/b.spec.js"));

        expect(useStore.getState().selectedSpec).toBe("test/b.spec.js");
        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
    });
});
```

You'll need to add `import { useStore } from "./state/store";` and extend the existing imports (`describe, it, expect, vi, beforeEach`).

**Step 2: Run test to verify it passes against current code.**

```bash
npm run test -w @debug-gui/web -- --run App.test.tsx
```

Expected: PASS. (This documents existing behavior — no implementation change yet.)

**Step 3: Commit.**

```bash
git add packages/debug-gui/web/src/App.test.tsx
git commit -m "test(debug-gui): regression test for idle-state suite click passthrough"
```

---

## Task 2: Failing test — dialog opens when state is "running"

**Files:**
- Modify: `packages/debug-gui/web/src/App.test.tsx`

**Step 1: Add a failing test in the same `describe("App suite-switch confirmation", ...)` block.**

```tsx
it("running: clicking another suite opens confirm dialog and does NOT change selection", () => {
    useStore.setState({ state: { state: "running" } });
    render(<App />);

    fireEvent.click(screen.getByText("test/b.spec.js"));

    // Dialog mounted.
    expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
    // Selection not changed yet.
    expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
});
```

**Step 2: Run to verify it fails.**

```bash
npm run test -w @debug-gui/web -- --run App.test.tsx
```

Expected: FAIL. Dialog is not in DOM (no implementation yet) AND `selectedSpec` flipped to `test/b.spec.js` (current behavior is unconditional apply).

**Step 3: Implement `requestSelectionChange` + dialog skeleton in `App.tsx`.**

Open `packages/debug-gui/web/src/App.tsx`. Add imports:

```tsx
import { useEffect, useState } from "react";
import { EfDialog } from "./ui/EfDialog";
```

Inside `App`, after the existing `useStore` reads, add:

```tsx
const [pendingSelection, setPendingSelection] = useState<TestSelection | null>(null);
const [switching, setSwitching] = useState(false);
const isLive = state.state === "running" || state.state === "pre-running" || state.state === "paused";

const sameNode = (a: TestSelection["node"], b: TestSelection["node"]) =>
    (!a && !b) ||
    !!(a && b && a.kind === b.kind && a.fullTitle === b.fullTitle);

function requestSelectionChange(next: TestSelection | null) {
    const sameAsCurrent =
        (next?.spec ?? null) === selectedSpec && sameNode(next?.node ?? null, selectedNode);
    if (sameAsCurrent) return;
    if (!isLive) {
        useStore.setState({
            selectedSpec: next?.spec ?? null,
            selectedNode: next?.node ?? null,
        });
        return;
    }
    setPendingSelection(next);
}
```

Replace the existing `<TestTree onSelect={...}>` prop:

```tsx
onSelect={(sel) => requestSelectionChange(sel)}
```

Add the dialog markup at the end of `<main>` (before the closing `</main>`):

```tsx
<EfDialog
    opened={pendingSelection !== null || undefined}
    aria-label="Switch suite?"
    role="dialog"
    onCancel={() => { if (!switching) setPendingSelection(null); }}
>
    <div slot="header">Switch suite?</div>
    {!switching && (
        <div className="space-y-2 p-4">
            <p>A run is in progress. Switching will stop it. Continue?</p>
            <div className="text-xs opacity-70 font-mono">
                Current: {selectedSpec}{selectedNode ? ` — ${selectedNode.fullTitle}` : ""}
            </div>
            <div className="text-xs opacity-70 font-mono">
                New: {pendingSelection?.spec ?? "(clear selection)"}
                {pendingSelection?.node ? ` — ${pendingSelection.node.fullTitle}` : pendingSelection ? " — whole file" : ""}
            </div>
            <div className="flex gap-2 pt-2">
                <EfButton cta onClick={() => { /* wired in Task 4 */ }}>Switch</EfButton>
                <EfButton onClick={() => setPendingSelection(null)}>Keep running</EfButton>
            </div>
        </div>
    )}
</EfDialog>
```

**Step 4: Run the test again.**

```bash
npm run test -w @debug-gui/web -- --run App.test.tsx
```

Expected: PASS (dialog mounts; `selectedSpec` unchanged).

**Step 5: Commit.**

```bash
git add packages/debug-gui/web/src/App.tsx packages/debug-gui/web/src/App.test.tsx
git commit -m "feat(debug-gui): gate selection change behind confirm dialog while live"
```

---

## Task 3: Failing test — same-selection click during running is a no-op

**Files:**
- Modify: `packages/debug-gui/web/src/App.test.tsx`

**Step 1: Add the test.**

```tsx
it("running: clicking the current selection is a no-op (no dialog)", () => {
    useStore.setState({ state: { state: "running" } });
    render(<App />);

    fireEvent.click(screen.getByText("test/a.spec.js"));

    expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
});
```

**Step 2: Run to verify.**

```bash
npm run test -w @debug-gui/web -- --run App.test.tsx
```

Expected: PASS — `requestSelectionChange` already returns early on `sameAsCurrent`.

**Step 3: Commit.**

```bash
git add packages/debug-gui/web/src/App.test.tsx
git commit -m "test(debug-gui): same-selection click during run is no-op"
```

---

## Task 4: Failing test — Keep running button closes dialog without sending cancel

**Files:**
- Modify: `packages/debug-gui/web/src/App.test.tsx`

**Step 1: At the top of `describe("App suite-switch confirmation", ...)`, replace the existing global mock with a per-test spy. Hoist this above the `describe`:**

```tsx
const sendSpy = vi.fn();
vi.mock("./hooks/useWebSocket", () => ({
    useWebSocket: () => ({ send: sendSpy }),
}));
```

(Move the existing `vi.mock("./hooks/useWebSocket", ...)` out and merge into one. Reset `sendSpy` in `beforeEach`: `sendSpy.mockReset();`.)

**Step 2: Add the test.**

```tsx
it("running: clicking 'Keep running' closes dialog, does NOT send cancel, leaves selection", () => {
    useStore.setState({ state: { state: "running" } });
    render(<App />);

    fireEvent.click(screen.getByText("test/b.spec.js"));
    fireEvent.click(screen.getByRole("button", { name: /keep running/i }));

    expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
    expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
    expect(sendSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: "cancel" }));
});
```

**Step 3: Run.**

```bash
npm run test -w @debug-gui/web -- --run App.test.tsx
```

Expected: PASS — Keep running button is already wired to `setPendingSelection(null)` from Task 2.

**Step 4: Commit.**

```bash
git add packages/debug-gui/web/src/App.test.tsx
git commit -m "test(debug-gui): Keep running closes dialog without cancel"
```

---

## Task 5: Failing test — Switch button sends cancel + shows spinner + holds selection

**Files:**
- Modify: `packages/debug-gui/web/src/App.test.tsx`
- Modify: `packages/debug-gui/web/src/App.tsx`

**Step 1: Add the test.**

```tsx
it("running: clicking 'Switch' sends cancel, shows 'Stopping…', does NOT yet swap selection", () => {
    useStore.setState({ state: { state: "running" } });
    render(<App />);

    fireEvent.click(screen.getByText("test/b.spec.js"));
    fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

    expect(sendSpy).toHaveBeenCalledWith({ type: "cancel" });
    // Dialog still open, but in switching phase.
    expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
    expect(screen.getByText(/stopping current run/i)).toBeInTheDocument();
    // Buttons gone.
    expect(screen.queryByRole("button", { name: /^switch$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /keep running/i })).not.toBeInTheDocument();
    // Selection unchanged.
    expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
});
```

**Step 2: Run to verify it fails.**

Expected: FAIL. The Switch button onClick is still a no-op stub from Task 2.

**Step 3: Implement Switch + spinner block in `App.tsx`.**

Wire the Switch button:

```tsx
<EfButton cta onClick={() => {
    setSwitching(true);
    send({ type: "cancel" });
}}>Switch</EfButton>
```

Add a switching-phase block inside the dialog (after the `!switching && (...)` block):

```tsx
{switching && (
    <div className="flex items-center gap-3 p-4">
        <Spinner />
        <span>Stopping current run…</span>
    </div>
)}
```

**Step 4: Run.**

Expected: PASS.

**Step 5: Commit.**

```bash
git add packages/debug-gui/web/src/App.tsx packages/debug-gui/web/src/App.test.tsx
git commit -m "feat(debug-gui): Switch button sends cancel and shows stopping spinner"
```

---

## Task 6: Failing test — when state flips to idle, pending selection is applied

**Files:**
- Modify: `packages/debug-gui/web/src/App.test.tsx`
- Modify: `packages/debug-gui/web/src/App.tsx`

**Step 1: Add the test.**

```tsx
it("after Switch: when status flips to idle, pendingSelection is applied and dialog closes", () => {
    useStore.setState({ state: { state: "running" } });
    render(<App />);

    fireEvent.click(screen.getByText("test/b.spec.js"));
    fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

    // Simulate the server broadcasting status:idle (cancel landed).
    act(() => {
        useStore.getState().applyEvent({ type: "status", state: "idle" });
    });

    expect(useStore.getState().selectedSpec).toBe("test/b.spec.js");
    expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
});
```

Add `act` to the `@testing-library/react` import.

**Step 2: Run to verify it fails.**

Expected: FAIL. Selection stays on `test/a.spec.js` and dialog stays open — the apply useEffect doesn't exist yet.

**Step 3: Implement the apply useEffect in `App.tsx`.**

Add after the `requestSelectionChange` definition:

```tsx
useEffect(() => {
    if (!switching) return;
    if (state.state !== "idle" && state.state !== "done") return;
    if (pendingSelection !== null) {
        useStore.setState({
            selectedSpec: pendingSelection.spec,
            selectedNode: pendingSelection.node,
        });
    }
    setPendingSelection(null);
    setSwitching(false);
}, [switching, state.state, pendingSelection]);
```

**Step 4: Run.**

Expected: PASS.

**Step 5: Commit.**

```bash
git add packages/debug-gui/web/src/App.tsx packages/debug-gui/web/src/App.test.tsx
git commit -m "feat(debug-gui): apply pending suite selection once cancel lands"
```

---

## Task 7: Failing test — paused state also gates selection change

**Files:**
- Modify: `packages/debug-gui/web/src/App.test.tsx`

**Step 1: Add the test.**

```tsx
it("paused: clicking another suite opens confirm dialog", () => {
    useStore.setState({ state: { state: "paused" } });
    render(<App />);

    fireEvent.click(screen.getByText("test/b.spec.js"));

    expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
    expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
});
```

**Step 2: Run.**

Expected: PASS — `isLive` already covers `paused`.

**Step 3: Commit.**

```bash
git add packages/debug-gui/web/src/App.test.tsx
git commit -m "test(debug-gui): paused state also gates suite switch"
```

---

## Task 8: Failing test — SelectionPanel clear-node also gates while live

**Files:**
- Modify: `packages/debug-gui/web/src/App.test.tsx`
- Modify: `packages/debug-gui/web/src/App.tsx`

**Step 1: Add the test.**

```tsx
it("running: SelectionPanel clear button while node is selected opens confirm dialog", () => {
    useStore.setState({
        state: { state: "running" },
        selectedSpec: "test/a.spec.js",
        selectedNode: { kind: "it", fullTitle: "Login should pass" },
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));

    expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
    expect(useStore.getState().selectedNode).toEqual({ kind: "it", fullTitle: "Login should pass" });
});
```

**Step 2: Run to verify it fails.**

Expected: FAIL. The `SelectionPanel onClear` currently calls `useStore.setState({ selectedNode: null })` directly, bypassing the gate.

**Step 3: Re-route `SelectionPanel.onClear` through `requestSelectionChange`.**

In `App.tsx`, replace:

```tsx
onClear={() => useStore.setState({ selectedNode: null })}
```

with:

```tsx
onClear={() => requestSelectionChange({ spec: selectedSpec!, node: null })}
```

(Safe — `SelectionPanel` only renders when `selectedSpec` is non-null, so the `!` is sound. If you want to be cautious, gate the prop: `onClear={selectedSpec ? () => requestSelectionChange({ spec: selectedSpec, node: null }) : undefined}`.)

**Step 4: Run.**

Expected: PASS.

**Step 5: Commit.**

```bash
git add packages/debug-gui/web/src/App.tsx packages/debug-gui/web/src/App.test.tsx
git commit -m "feat(debug-gui): gate SelectionPanel clear behind switch-suite confirm"
```

---

## Task 9: UI lockout — extend disabled predicate to include `switching`

**Files:**
- Modify: `packages/debug-gui/web/src/App.tsx`
- Modify: `packages/debug-gui/web/src/App.test.tsx`

**Step 1: Add the test.**

```tsx
it("during switching: Stop button is disabled", () => {
    useStore.setState({ state: { state: "running" } });
    render(<App />);

    fireEvent.click(screen.getByText("test/b.spec.js"));
    fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

    expect(screen.getByRole("button", { name: /^stop$/i })).toBeDisabled();
});
```

**Step 2: Run.**

Expected: FAIL. Today `canStop` is `state === "running" || "paused"`, which is still true during the switching phase (`state.state` is still `running` until cancel lands).

**Step 3: Update `canStart` and `canStop` to factor in `switching`.**

In `App.tsx`:

```tsx
const canStart = !!selectedSpec && (state.state === "idle" || state.state === "done") && !preRunDirty && !switching;
const canStop = (state.state === "running" || state.state === "paused") && !switching;
const settingsDisabled = state.state === "running" || state.state === "pre-running" || state.state === "paused" || switching;
```

Also add `disabled={switching || undefined}` to the Continue button, the Mode toggle, and the PreRunRow disabled prop. (For the PreRunRow, OR `switching` into the existing predicate.)

**Step 4: Run.**

Expected: PASS.

**Step 5: Commit.**

```bash
git add packages/debug-gui/web/src/App.tsx packages/debug-gui/web/src/App.test.tsx
git commit -m "feat(debug-gui): lock UI controls while suite-switch cancel is in flight"
```

---

## Task 10: Manual smoke test against a real run

This is the only path that exercises the actual server cancel timing. Tests can mock `applyEvent({type:"status", state:"idle"})` instantly, but a real cancel takes hundreds of ms.

**Step 1: Build server + web, then launch debug-gui pointed at the WDIO fixture.**

```bash
npm run build -w @debug-gui/server
npm run build -w @debug-gui/web
node packages/debug-gui/bin/debug-gui.js
```

(The GUI launches a Chromium window automatically. If `bun install -g` was used to install global CLIs, follow the existing memory note about uv_spawn.)

**Step 2: In the GUI, walk through these scenarios manually:**

1. **Idle → click another suite:** selection swaps instantly, no dialog. ✅
2. **Run a suite (Start), wait until "running" status, click a different file:** dialog appears, current/new rows visible. Click "Keep running". Dialog closes, run continues, selection unchanged. ✅
3. **Same flow, click "Switch":** dialog stays open with spinner "Stopping current run…", Stop / Continue / Mode toggle / Settings cog all greyed out. After ~1s the dialog closes and the new file is selected. ✅
4. **Trigger a paused state (pick a fixture with intentionally wrong selectors), click another file:** dialog appears. Confirm Switch — verify the agent abort + cancel both fire and the new selection lands. ✅
5. **Click a different node (describe/it) inside the same file while paused:** dialog appears with "Current: file — node" / "New: file — different node" rows. ✅
6. **Click the SelectionPanel clear button while running with a node selected:** dialog appears with "New: file — whole file". ✅

**Step 3: If anything misbehaves, capture the failure (screenshot + console log) and fix the underlying issue. Do NOT mark the task complete until all six scenarios behave as described.**

**Step 4: Final verification + commit any fixes that emerged from manual testing.**

```bash
npm run test -w @debug-gui/web
npm run build -w @debug-gui/web
```

Both must pass with zero failures.

---

## Verification checklist (end of plan)

- [ ] All 9 task tests pass: `npm run test -w @debug-gui/web -- --run App.test.tsx`
- [ ] Full web suite passes: `npm run test -w @debug-gui/web`
- [ ] Web bundle builds: `npm run build -w @debug-gui/web`
- [ ] Manual smoke test (Task 10) all six scenarios passed
- [ ] No changes to `packages/debug-gui/server/` (server protocol unchanged — sanity-check with `git diff main -- packages/debug-gui/server/`)
