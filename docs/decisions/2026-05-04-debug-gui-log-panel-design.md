# Debug GUI — Log Panel Redesign

**Date:** 2026-05-04
**Status:** Implemented (with deltas — see end)
**Owner:** QA tooling
**Branch:** `feature/debug-gui-log-panel`
**Worktree:** `.worktrees/debug-gui-log-panel/`
**Supersedes:** the bare-bones `MochaLogPanel.tsx` rendering

## Problem

Today's `MochaLogPanel` is a single `<pre>` of raw mocha output. QA cannot
see, at a glance:

- run progress (how many steps run, of how many)
- pass / fail / heal counts
- which test is currently executing (breadcrumb of file → suite → it)
- which line in the log is the failure vs. info vs. self-heal action
- diff context for selector-healing edits

The supplied mockup (a "cockpit" view with status, stats, breadcrumb, and a
levelled event table) describes the target. We rebuild the panel to that
visual contract while reusing **refinitiv-ui (halo-dark)** components and
tokens for management-visible polish.

## Goals

- **Match the mockup's visual structure** — status header, stats strip,
  breadcrumb, level-tagged log table, self-heal block.
- **Reuse existing data** — no new server events for v1. Drive everything
  from store fields already populated: `state`, `mochaLog`, `currentFailure`,
  `pendingDiff`, `selectedSpec`, `selectedNode`, `config`.
- **Use refinitiv-ui where it pulls weight** — `EfPanel` containers,
  `EfIcon` glyphs, halo-dark CSS variables for color tokens, `EfButtonBar`
  reuse via the existing `ModeToggle`.
- **Honest about unwired metrics** — `AVG CONF`, `TIME SAVED`, `HEALING TREND
  7D` have no real source today. Show them with a clearly-muted "—" so QA
  understands they are placeholders, not stale data.

## Non-goals (v1)

- No backend protocol changes. `test_progress` exists in `messages.ts` but
  isn't actually broadcast — we **don't** wire it up here. Pass/fail counts
  come from parsing `mochaLog` text client-side.
- No persistence of healing trends across runs (would need server-side
  history; deferred).
- No replacement of the existing top App toolbar (Start/Stop/Status/Mode
  buttons stay where they are). We add a stats strip and a richer log panel
  beneath it.
- No Monaco editor / external scroll virtualization for the log (≤500 lines
  buffered already in store).

## Architecture

### File layout (additions)

```
packages/debug-gui/web/src/components/
├── LogPanel.tsx           # NEW — top-level, replaces MochaLogPanel rendering
├── LogPanel.test.tsx      # NEW
├── log/
│   ├── StatusHeader.tsx   # status pill + elapsed + step counter
│   ├── StatsStrip.tsx     # 6-cell metric row (PASSED/FAILED/HEALED/CONF/TIME/TREND)
│   ├── Breadcrumb.tsx     # file > suite > it + step dots
│   ├── LogTable.tsx       # the table itself
│   ├── LogRow.tsx         # one row (TIME · LEVEL · STEP · EVENT)
│   ├── SelfHealBlock.tsx  # cyan-bordered diff card
│   └── deriveLog.ts       # mochaLog + currentFailure + pendingDiff → LogRow[]
```

`MochaLogPanel.tsx` is left untouched on disk for now (the build still
references it via tests we don't want to churn). `App.tsx` stops importing
it and renders `<LogPanel />` instead.

### Data flow

```
store (zustand)
  ├── state.state, state.currentFailure
  ├── mochaLog[]      ← derive: rows + counts + step counter
  ├── pendingDiff     ← derive: SelfHealBlock when present
  ├── selectedSpec / selectedNode  ← Breadcrumb
  ├── config.agent.mode  ← already on top toolbar
  └── (NEW) runStartedAt, healCount   ← added below
        ↓
LogPanel (memoised selectors)
  ↓
StatusHeader · StatsStrip · Breadcrumb · LogTable · SelfHealBlock
```

### Store additions

Two minimal new fields, populated by `applyEvent`:

| Field | Type | Set by | Purpose |
|---|---|---|---|
| `runStartedAt` | `number \| null` | `status` event when entering `running` / `pre-running` | Drives the elapsed timer |
| `healCount` | `number` | client-side increment on `diff_decision` action `approved` | Drives the HEALED metric |

`runStartedAt` resets to `null` on `idle`/`done` so the timer freezes. The
elapsed value is computed in `StatusHeader` via a 250 ms `setInterval` while
state is `running`/`pre-running` — no constant re-renders elsewhere. On
`paused` the interval is cleared and a `[state]` effect snaps `now` to the
transition moment, so the displayed elapsed freezes at the pause time
rather than continuing to count while QA triages.

### `deriveLog.ts` — text → structured rows

Parses `mochaLog` lines (plus injects synthetic rows for paused / diff
events) into:

```ts
type LogLevel = "SYS" | "INFO" | "PASS" | "FAIL" | "WARN" | "SELF-HEAL";

interface LogRow {
  id: string;                  // stable index for React key
  time: string;                // mm:ss.SSS relative to runStartedAt
  level: LogLevel;
  step: number | null;         // null for SYS / SELF-HEAL
  text: string;                // event description
  // SELF-HEAL only:
  heal?: {
    strategy: string;
    confidence?: number;
    durationMs?: number;
    oldCode: string;
    newCode: string;
  };
}
```

Heuristics (intentionally simple, easy to dial up later):

- Stream `stderr` → WARN (unless line contains `Error:` → FAIL).
- Lines starting with `[pre-run]` → SYS.
- Mocha tick `✓` / `✔` → PASS, increments step counter.
- Mocha cross `✗` / `✘` / `1)` / `2)` → FAIL.
- Lines containing `passing` / `failing` summary → SYS.
- Default → INFO.
- Synthetic rows:
  - `state.currentFailure` set → FAIL row pinned at the bottom.
  - `pendingDiff` present → SELF-HEAL row + `SelfHealBlock` rendered below.

The `step` counter is monotonically incremented on every PASS / FAIL row in
chronological order, then surfaced both inline on the row and in the top
StatusHeader (`STEP n/total`). `total` = the sum of all PASS+FAIL+pending so
far; for v1 this is "ran out of n", which is honest given we don't know the
plan ahead of execution.

### Visual / refinitiv-ui mapping

| Mockup element | Implementation | refinitiv-ui usage |
|---|---|---|
| Outer container | `<EfPanel>` with `display:block` | ✓ `EfPanel` |
| Status pill `● RUNNING` | colored chip; dot uses `var(--ef-success)` / `var(--ef-warning)` | refinitiv-ui CSS tokens |
| Stats card | nested `<EfPanel>` per metric, terse `<dt>/<dd>` | ✓ `EfPanel` |
| Trend bars | inline SVG `<rect>`s, color = `var(--ef-primary)` | tokens only |
| Breadcrumb chevrons | `EfIcon icon="right"` (halo set has it) | ✓ `EfIcon` |
| Step dots | small SVG circles, fills via halo tokens | tokens only |
| Level badge | inline `<span>` with token-coloured bg, monospace text | refinitiv-ui CSS tokens; no badge primitive in halo wrapper layer |
| Self-heal block | `<EfPanel>` with `border-left:3px solid var(--ef-info-secondary)` | ✓ `EfPanel` + tokens |
| Diff lines | `<DiffView>` already exists; we reuse for the +/- lines | ✓ existing |

Color tokens (halo-dark, already loaded via `ui/theme.ts`):

| Level | Token |
|---|---|
| SYS | `--ef-content-secondary-color` (muted) |
| INFO | `--ef-primary` (LSEG navy-blue accent) |
| PASS | `--ef-success` (green) |
| FAIL | `--ef-error` (red) |
| WARN | `--ef-warning` (amber) |
| SELF-HEAL | `--ef-info` (cyan/teal) |

If a token is missing in halo-dark we fall back to a Tailwind class with the
closest hex. We **don't** introduce a custom color palette.

## Component contracts

```ts
// LogPanel.tsx
export function LogPanel(): JSX.Element;
// reads from useStore directly; no props. App.tsx renders <LogPanel /> in
// place of <MochaLogPanel />.

// StatusHeader.tsx
interface StatusHeaderProps {
  state: SessionState;
  startedAt: number | null;
  step: number;
  total: number;
}

// StatsStrip.tsx
interface StatsStripProps {
  passed: number;
  failed: number;
  healed: number;
  // future cells passed as `null`; component renders "—"
  avgConf?: number | null;
  timeSavedSec?: number | null;
  trend7d?: number[] | null;
}

// Breadcrumb.tsx
interface BreadcrumbProps {
  spec: string | null;
  suite?: string | null;     // describe full title
  test?: string | null;      // it full title
  step: number;
  total: number;
}

// LogTable.tsx
interface LogTableProps {
  rows: LogRow[];
}

// SelfHealBlock.tsx
interface SelfHealBlockProps {
  strategy: string;
  confidence?: number;
  durationMs?: number;
  oldCode: string;
  newCode: string;
  filePath?: string;
}
```

## Error handling

- Empty / idle state — LogPanel renders a quiet "Run a test to see the live
  log here" placeholder inside the same `EfPanel`. No layout shift between
  empty and populated.
- Truncated `mochaLog` (already capped at 500 lines in store) — derived
  rows are also capped; we add a "log truncated, scroll up to see all"
  banner inside the table when the source array is at the cap.
- Parse failure (regex didn't match) — line falls into INFO bucket. Not an
  error; just less useful styling.

## Testing strategy

| Layer | Approach |
|---|---|
| `deriveLog.test.ts` | Vitest — fixture mochaLog arrays → expected `LogRow[]`. Covers each level heuristic + step monotonicity + synthetic FAIL/SELF-HEAL injection. |
| `LogPanel.test.tsx` | RTL — mounts LogPanel with mocked zustand state. Asserts: status pill text, breadcrumb spec/suite/test, row count, level badge for first failing line. |
| `StatsStrip.test.tsx` | RTL — confirms "—" rendered for null cells; trend SVG renders one `<rect>` per value. |
| smoke (manual) | `npm run dev` in worktree; click Run on the existing failing-selector spec → eyeball mockup parity. |

Existing `MochaLogPanel.test.tsx` is removed once `App.tsx` stops mounting
the old component (the test would render dead UI).

## Migration

1. Land all new components + `deriveLog.ts` + tests (no behavior change yet).
2. Switch `App.tsx` to import `LogPanel` instead of `MochaLogPanel`. Delete
   `MochaLogPanel.tsx` + `MochaLogPanel.test.tsx`.
3. Smoke test with the existing walkthrough fixture.

## Deferred

- **Real `test_progress` events** — replace the client-side mocha-text
  parsing once the runtime hook starts emitting structured progress.
- **Persistent stats** — `AVG CONF`, `TIME SAVED`, `HEALING TREND` need a
  server-side run history; render real values once the data source exists.
- **Resizable / detachable log** — leave at fixed flex height for v1.
- **Filter / search** within the log — out of scope for the visual rework.

## Key rules for implementation

- **Never** add new color hexes outside the halo-dark token set; use Tailwind
  fallback only when no token fits (and document it inline).
- **Never** parse mocha text on the server in this PR — the parsing lives in
  `deriveLog.ts` and is replaceable. This keeps the door open for the
  `test_progress` migration without churning the renderer.
- **Reuse `DiffView`** for the self-heal +/- lines. Don't re-author a diff
  renderer; LogPanel composes the existing component.
- **Don't import from the server bundle**. The web bundle stays independent
  (mirror types where needed, as is the existing convention).

## Implementation deltas (2026-05-05)

Recorded post-merge so the doc reflects what was actually shipped, not
just the original intent.

- **`StatsStrip` not built.** All six metric cells (PASSED / FAILED /
  HEALED / AVG CONF / TIME SAVED / HEALING TREND 7D) were unwired
  placeholders; deferred until a real data source exists for any of them.
  PASSED / FAILED show up in the `StatusHeader` STEP counter instead.
- **`MochaLogPanel.tsx` deleted.** Plan said "left untouched"; in
  practice the dead component + its test caused noise so both were
  removed when `App.tsx` switched to `<LogPanel />`. No other consumers.
- **`DiffView` reuse skipped for `SelfHealBlock`.** The full Shiki-backed
  `DiffView` was too heavy for an inline row — `SelfHealBlock` renders a
  minimal two-line `+/-` block with hard-coded colours. If/when QA needs
  syntax-highlighted self-heal diffs, re-evaluate then.
- **Synthetic-row timestamps moved into the store.** Plan didn't address
  this; `Date.now()` inside `deriveLog` proved fragile under re-renders.
  Reducer now stamps `Snapshot.pausedAt` and `Diff.receivedAt` so
  `deriveLog` is pure of wall-clock reads.
- **Log row React keys.** Source line gets a monotonic `seq` at push time
  so existing rows survive the buffer's `slice(-500)` without React
  unmount/remount churn. Plan called the id "stable index for React key"
  but the original implementation used the array index.
- **`LogTable` ARIA roles dropped.** Maintaining a valid `role="table"`
  tree alongside the `SELF-HEAL` block (which would need its own
  rowgroup) was more cost than benefit; the table is now a labelled
  `<section>` with grid-driven CSS.
- **`SelfHealBlock` plain `<section>` instead of `EfPanel`.** Original
  used `EfPanel` and needed seven `!important` rules to override
  shadow-DOM defaults. Replaced with a plain `<section>`; styles no
  longer fight the wrapper.
