# Debug GUI — Confirm-and-graceful-exit when QA switches suites mid-run

## Context

Today the left-sidebar tree (`TestTree`) and the middle-panel `SelectionPanel` both mutate `selectedSpec`/`selectedNode` in the Zustand store the instant QA clicks. There is no guard for session state. So while a run is live (`state.state ∈ {running, pre-running, paused}`), QA can silently change the selection out from under the active mocha process. The Stop button is the only way to actually end the run, and the two flows are unrelated: clicking another file does not stop the run, but does change which file the *next* Start would target — confusing and easy to misread.

QA's mental model is "I want to switch what I'm debugging." They expect the GUI to ask first and then exit cleanly.

## Goal

When the QA tries to change the selection while a run is live:
1. Pop a confirmation dialog before applying the new selection.
2. If they confirm, gracefully stop the live run and **only then** apply the new selection.
3. Lock the rest of the UI between confirm and "stopped" so QA cannot click into a half-cancelled state.

## Scope (decided)

- **In**: any selection mutation that originates in `App.tsx` — `TestTree.onSelect` (changing `selectedSpec` and/or `selectedNode`) **and** `SelectionPanel.onClear` (resetting `selectedNode`).
- **In**: the gate fires for all three live states: `running`, `pre-running`, `paused`.
- **In**: a "switching" loading state that holds the dialog open with a spinner until the server confirms the run is no longer live.
- **Out**: server protocol changes. The existing `{type:"cancel"}` WS message already does the graceful-exit work (`runner.kill()` via `tree-kill`, `currentAgentSession.abort()`, status flips back to `idle`).
- **Out**: auto-Start of the new selection after the cancel completes. QA reviews the new selection and clicks Start manually.
- **Out**: timeout / retry logic if the cancel hangs. Reuses the same path as the Stop button; if that one is reliable so is this.

## Design decisions

### Where the gate lives

All new logic is local to `web/src/App.tsx`. `TestTree`, `SelectionPanel`, and the server stay dumb. Two pieces of `useState` in `App`:

```ts
const [pendingSelection, setPendingSelection] = useState<TestSelection | null>(null);
const [switching, setSwitching] = useState(false);
```

A single wrapper handles both selection-change paths:

```ts
const isLive = state.state === "running" || state.state === "pre-running" || state.state === "paused";

function requestSelectionChange(next: TestSelection | null) {
    const sameAsCurrent =
        next?.spec === selectedSpec &&
        sameNode(next?.node ?? null, selectedNode);
    if (sameAsCurrent) return;
    if (!isLive) {
        useStore.setState({ selectedSpec: next?.spec ?? null, selectedNode: next?.node ?? null });
        return;
    }
    setPendingSelection(next);
}
```

`TestTree`'s `onSelect` and `SelectionPanel`'s `onClear` (which becomes `requestSelectionChange({spec: selectedSpec!, node: null})`) both go through this wrapper. The dialog is open whenever `pendingSelection !== null`.

### Dialog UX

- Built on the existing `<EfDialog>` wrapper (`web/src/ui/EfDialog.tsx`) for refinitiv-ui consistency.
- **Header:** "Switch suite?"
- **Body (idle phase, `switching === false`):**
  - "A run is in progress. Switching will stop it. Continue?"
  - Two short rows showing `Current: <spec> [— <node title>]` and `New: <pendingSelection.spec> [— <pendingSelection.node title> | whole file]`.
- **Buttons:** primary `EfButton cta` "Switch" + secondary `EfButton` "Keep running". ESC and backdrop click both = "Keep running" (via `EfDialog`'s `onCancel` event).

### Switching phase

When QA clicks "Switch":
1. `setSwitching(true)`
2. `send({ type: "cancel" })`
3. Dialog body swaps to a single line: "Stopping current run…" with the existing `<Spinner>` component. Both buttons hide; ESC and backdrop are gated off until the cancel resolves. This is the "loading till cancel successfully" requirement.

A `useEffect([switching, state.state, pendingSelection])` watches for the cancel landing:

```ts
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

`pendingSelection` may legitimately be `null` (when QA cleared selection while live), so the apply branch handles both shapes.

### UI lockout while switching

Today `settingsDisabled` is `state.state === "running" || "pre-running" || "paused"`. Extend the same idea to a single derived `uiBusy = isLive || switching`:

- `TestTree` rows: pass a new `disabled` prop (or wrap `onSelect` in a no-op when busy — chosen variant decided in implementation, but the behavioral guarantee is "tree clicks do nothing during `switching`").
- Start, Stop, Continue, Mode toggle, Settings cog, PreRun row: all already gate on a similar predicate; they'll read `uiBusy` instead.
- The dialog itself stays interactive only via its own internal lifecycle (it owns the cancel/keep buttons).

### Failure mode

If the server never transitions out of live (cancel hangs): the dialog stays on "Stopping current run…" indefinitely. This is the same failure surface as the existing Stop button — `runner.kill()` + `tree-kill` are already the reliable path. No retry/timeout logic added. YAGNI.

## Test plan

Added to `web/src/App.test.tsx` (already exists, has WS + store harness):

1. **No dialog when idle** — `state.state === "idle"`, click a tree row → `selectedSpec` updates immediately, no dialog renders.
2. **Dialog opens when running** — `state.state === "running"` with a current selection, click a *different* tree row → dialog appears, `selectedSpec` unchanged.
3. **Same-selection click is a no-op** — clicking the *current* selection while running does not open the dialog.
4. **Keep-running path** — open dialog, click "Keep running" → dialog closes, `pendingSelection` cleared, no `cancel` WS message sent, `selectedSpec` unchanged.
5. **Switch + cancel + apply path** — open dialog, click "Switch" → `cancel` WS message sent, dialog stays open showing spinner, `selectedSpec` *not yet* changed. Dispatch a mocked `status: idle` event from the WS hook → store applies `pendingSelection`, dialog closes, `switching` clears.
6. **Paused state also gates** — same as #2 with `state.state === "paused"`.
7. **SelectionPanel clear gates too** — render with running + selection + selected-node, click clear button → dialog opens with the "to: whole-file" rendering.

No server-side tests needed — server protocol is unchanged.

## Out of scope / future work

- Auto-Start of the new selection after the cancel — explicitly rejected; "graceful exit" reads as a clean stop.
- Toast/feedback when cancel finishes — the dialog closing and the new selection appearing are sufficient feedback.
- Keyboard shortcut to confirm — ESC already maps to "Keep running" via `EfDialog`; a confirm-via-Enter shortcut can land later if QA asks.
