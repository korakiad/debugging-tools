# Empty-State Nudges Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace blank empty states in `TestTree`, `TreePicker`, and `GlobList` with text + (where actionable) buttons that explain what's happening and offer recovery.

**Architecture:** Three component-local conditional render branches. No new shared component. `TestTree` gains an `onOpenSettings` callback (and `settingsDisabled` flag) wired in `App.tsx` to the existing settings-dialog state. `TreePicker` swaps in a sibling div for `<EfTree>` when data is empty. `GlobList` prepends a one-line hint above its existing Add button.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest + React Testing Library.

---

## Pre-flight

- Worktree: `G:\claude-project\debuggig-tools\.worktrees\debug-gui` (already on branch `feature/debug-gui`).
- The design doc lives at `docs/plans/2026-04-26-empty-states-design.md` — re-read if you need the rationale for any decision.
- Run the existing test suite once to confirm a green baseline before starting:
  - `npm run test -w @debug-gui/web -- --run`
  - Expected: all current tests pass.

---

## Task 1: `TestTree` empty state — failing test

**Files:**
- Modify: `packages/debug-gui/web/src/components/TestTree.test.tsx`

**Step 1: Append the failing tests to the existing `describe("TestTree", ...)` block.**

```tsx
it("renders an empty-state nudge when there are no suites", () => {
    render(
        <TestTree
            suites={[]}
            selectedSpec={null}
            onSelect={() => {}}
            onOpenSettings={() => {}}
        />
    );
    expect(screen.getByText(/no test files discovered/i)).toBeInTheDocument();
    expect(
        screen.getByRole("button", { name: /open settings/i })
    ).toBeInTheDocument();
});

it("clicking the empty-state Open Settings button calls onOpenSettings", () => {
    const onOpenSettings = vi.fn();
    render(
        <TestTree
            suites={[]}
            selectedSpec={null}
            onSelect={() => {}}
            onOpenSettings={onOpenSettings}
        />
    );
    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
});

it("disables the empty-state Open Settings button when settingsDisabled", () => {
    render(
        <TestTree
            suites={[]}
            selectedSpec={null}
            onSelect={() => {}}
            onOpenSettings={() => {}}
            settingsDisabled
        />
    );
    expect(screen.getByRole("button", { name: /open settings/i })).toBeDisabled();
});
```

**Step 2: Run the new tests and confirm they fail.**

Run: `npm run test -w @debug-gui/web -- --run TestTree`
Expected: 3 new tests fail (TS error: `onOpenSettings` not in props, or runtime "Unable to find element").

**Step 3: Commit the failing tests.**

```bash
git add packages/debug-gui/web/src/components/TestTree.test.tsx
git commit -m "test(debug-gui): add empty-state expectations for TestTree"
```

---

## Task 2: `TestTree` empty state — implementation

**Files:**
- Modify: `packages/debug-gui/web/src/components/TestTree.tsx`

**Step 1: Update the component.**

Replace the entire file with:

```tsx
interface Suite {
    relPath: string;
    absPath: string;
}

export function TestTree({
    suites,
    selectedSpec,
    onSelect,
    onOpenSettings,
    settingsDisabled,
}: {
    suites: Suite[];
    selectedSpec: string | null;
    onSelect: (relPath: string) => void;
    onOpenSettings?: () => void;
    settingsDisabled?: boolean;
}) {
    return (
        <nav className="w-64 border-r h-full overflow-auto p-2">
            <h2 className="text-sm font-bold mb-2">Test Suites</h2>
            {suites.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm">
                    <p className="opacity-70 mb-1">No test files discovered.</p>
                    <p className="opacity-60 text-xs mb-3">
                        Check your discovery globs in Settings.
                    </p>
                    {onOpenSettings && (
                        <button
                            type="button"
                            onClick={onOpenSettings}
                            disabled={settingsDisabled}
                            className="px-3 py-1 rounded border border-gray-600 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Open Settings ⚙
                        </button>
                    )}
                </div>
            ) : (
                <ul className="space-y-1">
                    {suites.map((s) => {
                        const isSelected = s.relPath === selectedSpec;
                        return (
                            <li key={s.relPath}>
                                <button
                                    type="button"
                                    className={`suite-row${isSelected ? " suite-row-selected" : ""}`}
                                    aria-pressed={isSelected}
                                    onClick={() => onSelect(s.relPath)}
                                >
                                    {s.relPath}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </nav>
    );
}
```

**Step 2: Run the tests and confirm they pass.**

Run: `npm run test -w @debug-gui/web -- --run TestTree`
Expected: all `TestTree` tests pass (existing + 3 new).

**Step 3: Commit.**

```bash
git add packages/debug-gui/web/src/components/TestTree.tsx
git commit -m "feat(debug-gui): show empty-state nudge in TestTree when no suites"
```

---

## Task 3: Wire `onOpenSettings` in `App.tsx`

**Files:**
- Modify: `packages/debug-gui/web/src/App.tsx`

**Step 1: Update the `<TestTree />` invocation to pass the new props.**

Find the existing usage:

```tsx
<TestTree
    suites={suites}
    selectedSpec={selectedSpec}
    onSelect={(spec) => useStore.setState({ selectedSpec: spec })}
/>
```

Replace with:

```tsx
<TestTree
    suites={suites}
    selectedSpec={selectedSpec}
    onSelect={(spec) => useStore.setState({ selectedSpec: spec })}
    onOpenSettings={() => setSettingsOpen(true)}
    settingsDisabled={settingsDisabled}
/>
```

**Step 2: Type-check + run all web tests.**

Run: `npm run build -w @debug-gui/web`
Expected: clean tsc output (no errors).

Run: `npm run test -w @debug-gui/web -- --run`
Expected: all tests pass.

**Step 3: Commit.**

```bash
git add packages/debug-gui/web/src/App.tsx
git commit -m "feat(debug-gui): wire TestTree empty-state Open Settings to App"
```

---

## Task 4: `TreePicker` empty state — failing test

**Files:**
- Modify: `packages/debug-gui/web/src/components/TreePicker.test.tsx`

**Step 1: Add a new render-based test block at the bottom of the file.**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TreePicker, toTreeData, resolveSelection, buildFilterFromExtensions, type FsTreeNode } from "./TreePicker";
```

(Adjust the existing top import line to add `render`, `screen`, `waitFor` and `TreePicker` — keep all current named exports too.)

Then append:

```tsx
describe("TreePicker render", () => {
    it("shows an empty-state nudge when the fetched tree has no children", async () => {
        const fetchTree = async () => ({
            root: { name: "proj", path: "", isDir: true, children: [] } as FsTreeNode,
        });
        render(
            <TreePicker
                open
                fetchTree={fetchTree}
                onPick={() => {}}
                onCancel={() => {}}
            />
        );
        await waitFor(() => {
            expect(screen.getByText(/no files matched/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/widening the extensions/i)).toBeInTheDocument();
    });
});
```

**Step 2: Run the new test and confirm it fails.**

Run: `npm run test -w @debug-gui/web -- --run TreePicker`
Expected: new render test fails (text not present — the empty `<EfTree>` is rendered instead).

If the test errors out due to the unregistered `<ef-tree>` custom element rather than failing the assertion, that's still acceptable — the next task will replace the empty `<EfTree>` with a normal div which sidesteps the issue.

**Step 3: Commit.**

```bash
git add packages/debug-gui/web/src/components/TreePicker.test.tsx
git commit -m "test(debug-gui): expect TreePicker empty-state nudge"
```

---

## Task 5: `TreePicker` empty state — implementation

**Files:**
- Modify: `packages/debug-gui/web/src/components/TreePicker.tsx`

**Step 1: Replace the `!loading && !error` render branch.**

Find:

```tsx
{!loading && !error && (
    <div className="max-h-[50vh] overflow-auto border border-gray-700 rounded p-2 mb-3">
        <EfTree ref={treeRef as any} multiple />
    </div>
)}
```

Replace with:

```tsx
{!loading && !error && (
    <div className="max-h-[50vh] overflow-auto border border-gray-700 rounded p-2 mb-3">
        {data.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm">
                <p className="opacity-70 mb-1">No files matched.</p>
                <p className="opacity-60 text-xs">
                    Try widening the extensions, or pick a different folder.
                </p>
            </div>
        ) : (
            <EfTree ref={treeRef as any} multiple />
        )}
    </div>
)}
```

**Step 2: Run the tests and confirm they pass.**

Run: `npm run test -w @debug-gui/web -- --run TreePicker`
Expected: all TreePicker tests pass (pure-function + new render test).

**Step 3: Commit.**

```bash
git add packages/debug-gui/web/src/components/TreePicker.tsx
git commit -m "feat(debug-gui): show empty-state nudge inside TreePicker"
```

---

## Task 6: `GlobList` empty hint — failing test

**Files:**
- Modify: `packages/debug-gui/web/src/components/SettingsDialog.test.tsx`

**Step 1: Append a new test inside the existing `describe("SettingsDialog", ...)` block.**

```tsx
it("shows a 'no patterns yet' hint when a glob list is empty", () => {
    render(
        <SettingsDialog
            open
            config={{ discovery: { globs: [], exclude: [] } }}
            onSave={() => {}}
            onClose={() => {}}
        />
    );
    // Two empty lists → two hints (one above globs, one above excludes).
    expect(screen.getAllByText(/no patterns yet/i).length).toBe(2);
});

it("hides the 'no patterns yet' hint after the user adds a row", () => {
    render(
        <SettingsDialog
            open
            config={{ discovery: { globs: [], exclude: ["x"] } }}
            onSave={() => {}}
            onClose={() => {}}
        />
    );
    // Only the empty glob list shows the hint.
    expect(screen.getAllByText(/no patterns yet/i).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /add glob/i }));
    expect(screen.queryByText(/no patterns yet/i)).not.toBeInTheDocument();
});
```

**Step 2: Run the tests and confirm they fail.**

Run: `npm run test -w @debug-gui/web -- --run SettingsDialog`
Expected: 2 new tests fail (text not present).

**Step 3: Commit.**

```bash
git add packages/debug-gui/web/src/components/SettingsDialog.test.tsx
git commit -m "test(debug-gui): expect empty-list hint in GlobList"
```

---

## Task 7: `GlobList` empty hint — implementation

**Files:**
- Modify: `packages/debug-gui/web/src/components/SettingsDialog.tsx`

**Step 1: Update the `GlobList` function.**

Find:

```tsx
function GlobList({ values, onChange, inputAriaLabel, addLabel, placeholder }: GlobListProps) {
    return (
        <div className="space-y-1">
            {values.map((v, i) => (
                ...existing row markup...
            ))}
            <button
                type="button"
                onClick={() => onChange([...values, ""])}
                className="px-2 py-1 rounded border border-gray-600 text-xs"
            >
                {addLabel}
            </button>
        </div>
    );
}
```

Insert the hint immediately before the Add button (i.e. after the `.map`). Final shape:

```tsx
function GlobList({ values, onChange, inputAriaLabel, addLabel, placeholder }: GlobListProps) {
    return (
        <div className="space-y-1">
            {values.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                    <input
                        type="text"
                        aria-label={`${inputAriaLabel} ${i + 1}`}
                        value={v}
                        placeholder={placeholder}
                        onChange={(e) => {
                            const next = [...values];
                            next[i] = e.target.value;
                            onChange(next);
                        }}
                        className="px-2 py-1 rounded border border-gray-600 bg-transparent font-mono text-xs flex-1"
                    />
                    <button
                        type="button"
                        aria-label={`remove ${inputAriaLabel} ${i + 1}`}
                        onClick={() => onChange(values.filter((_, j) => j !== i))}
                        className="px-2 py-1 rounded border border-gray-600 text-xs"
                    >
                        Remove
                    </button>
                </div>
            ))}
            {values.length === 0 && (
                <p className="opacity-60 text-xs">No patterns yet.</p>
            )}
            <button
                type="button"
                onClick={() => onChange([...values, ""])}
                className="px-2 py-1 rounded border border-gray-600 text-xs"
            >
                {addLabel}
            </button>
        </div>
    );
}
```

**Step 2: Run the tests and confirm they pass.**

Run: `npm run test -w @debug-gui/web -- --run SettingsDialog`
Expected: all SettingsDialog tests pass.

**Step 3: Commit.**

```bash
git add packages/debug-gui/web/src/components/SettingsDialog.tsx
git commit -m "feat(debug-gui): show 'no patterns yet' hint in empty GlobList"
```

---

## Task 8: Full verification

**Files:**
- None (verification only).

**Step 1: Run the full web test suite.**

Run: `npm run test -w @debug-gui/web -- --run`
Expected: all tests pass, no warnings about act() leaks or unhandled promises.

**Step 2: Run the web build (catches any TS issue introduced by the new prop signature).**

Run: `npm run build -w @debug-gui/web`
Expected: clean `tsc -b` + Vite build, no errors.

**Step 3: Manual smoke (optional but recommended).**

If a project with no matching tests is available locally:
- `npm run build -w @debug-gui/server`
- `node packages/debug-gui/bin/debug-gui.js`
- Confirm the sidebar shows the "No test files discovered" nudge with a working "Open Settings ⚙" button.
- Open Settings → clear all globs → click Save → confirm the empty-list hint appears under each list.
- In Settings → Browse… → set extensions to something nonsensical (e.g. `qqq`) → confirm "No files matched." appears inside the picker box.

**Step 4: Final commit if any docs were touched during verification (likely none).**

```bash
git status
# If clean, no commit needed.
```

---

## Done criteria

- All three empty surfaces show informative text.
- `TestTree`'s empty state has a working "Open Settings ⚙" button wired to the existing dialog.
- `TreePicker`'s empty tree shows a hint instead of an empty bordered box.
- `GlobList` shows a single dim line above the Add button when its list is empty.
- `npm run test -w @debug-gui/web -- --run` is green.
- `npm run build -w @debug-gui/web` is clean.
- Each task above has its own commit (8 commits total in the worst case, fewer if some tasks combine cleanly).
