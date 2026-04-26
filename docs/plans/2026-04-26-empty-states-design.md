# Debug GUI — Empty-state nudges for lists and file pickers

## Context

Three list-like surfaces in the debug GUI render **nothing** when their underlying array is empty. QA testers (the primary audience — non-technical) hit this regularly:

1. **`TestTree` (left sidebar)** — when discovery globs match no files, the panel shows the "Test Suites" heading and a blank space below it. First-launch impression is "the app is broken."
2. **`TreePicker` (Settings → Browse modal)** — when the file tree fetch returns zero matching files (extension filter too narrow, project root has no tests), the bordered tree box is empty with no explanation.
3. **`GlobList` (Settings → globs / excludes)** — when `values.length === 0`, the `Add glob` / `Add exclude` button is shown but nothing else. Less broken-feeling than the other two, but still under-explained.

Goal: replace each empty surface with a short text nudge plus, where actionable, a button that gets the user un-stuck.

## Scope (decided)

- **In**: empty-state UI for `TestTree`, `TreePicker`, and `GlobList` (a small hint above the existing Add button).
- **Out**: a generic reusable `<EmptyState />` component. Three surfaces with distinct copy and distinct actions don't justify the abstraction yet. Revisit if a fourth surface lands.
- **Out**: i18n / message catalogs. Strings stay inline.

## Design decisions

### `TestTree` — most painful, gets the strongest nudge
- When `suites.length === 0`, render a centered block beneath the heading:
  - Dim text: "No test files discovered." (line 1)
  - Dim text: "Check your discovery globs in Settings." (line 2)
  - Primary action button: "Open Settings ⚙" — calls a new `onOpenSettings` callback prop.
- `App.tsx` passes `onOpenSettings={() => setSettingsOpen(true)}` (the same setter the existing gear button uses).
- The button is disabled if `settingsDisabled` (running / pre-running / paused) for consistency with the gear icon. Caller passes that through too.

### `TreePicker` — nudge inside the tree box
- When the fetched tree has zero children **after** loading and **without** error, replace the empty `<EfTree>` with a centered hint inside the same bordered box:
  - "No files matched."
  - "Try widening the extensions, or pick a different folder."
- No new button. The Cancel button below already exists; the user adjusts extensions in the parent `SettingsDialog` and reopens the picker.
- Loading and error states are unchanged — the empty branch only fires when `!loading && !error && data.length === 0`.

### `GlobList` — small hint above the Add button
- When `values.length === 0`, render a single dim line above the existing Add button:
  - "No patterns yet."
- The Add button is unchanged. This is purely informational — visual confirmation that the empty state is intentional, not a render bug.

## Visual / styling

All three nudges reuse existing Tailwind utility patterns already in the codebase:
- `opacity-70` / `opacity-60` for the secondary copy (matches `SettingsDialog`'s helper text).
- `text-xs` for the small line in `GlobList`, `text-sm` for the larger nudges in `TestTree` / `TreePicker`.
- The "Open Settings ⚙" button uses the same `px-3 py-1 rounded border border-gray-600` pattern as the rest of the dialog buttons. No new design tokens.

No `refinitiv-ui` ef-tree empty-state slot is used (it doesn't expose one) — `TreePicker`'s empty branch is a sibling div that conditionally replaces the `<EfTree>` element entirely.

## Files to touch

- `packages/debug-gui/web/src/components/TestTree.tsx` — accept `onOpenSettings` (and `settingsDisabled`) props; render empty-state block.
- `packages/debug-gui/web/src/App.tsx` — pass the two new props to `TestTree`.
- `packages/debug-gui/web/src/components/TreePicker.tsx` — render empty-state block in place of `<EfTree>` when data is empty.
- `packages/debug-gui/web/src/components/SettingsDialog.tsx` — `GlobList` renders hint when `values.length === 0`.
- Tests:
  - `web/src/components/TestTree.test.tsx` — empty state renders nudge + button click invokes `onOpenSettings` (new file if missing).
  - `web/src/components/TreePicker.test.tsx` — empty fetched tree renders nudge.
  - `web/src/components/SettingsDialog.test.tsx` — empty `GlobList` renders hint.

## Verification

- `npm run test -w @debug-gui/web` — all three new test cases green.
- Manual: `npm run build -w @debug-gui/server && npm run build -w @debug-gui/web && node packages/debug-gui/bin/debug-gui.js` in a project with no matching tests; sidebar shows the nudge; clicking "Open Settings ⚙" opens the dialog.

## Trade-offs explicitly rejected

- **Reusable `<EmptyState />` component** — three sites, three shapes (block-with-button, inline-in-box, single-line-hint). Forcing them through one prop API would be parameter-soup; YAGNI says wait for the fourth case.
- **Text-only (no button)** — the user explicitly asked for "text **or** button," and `TestTree`'s empty state is genuinely actionable. Skipping the button here would just push a click into the gear icon search, which is the bug we're fixing.
- **Auto-open Settings when tree is empty** — too aggressive; an empty tree could also mean "the project genuinely has no tests yet" and a popup-on-load would be hostile.
