# Debug GUI — Surface package.json configs as GUI settings

## Context

The debug-gui already reads a handful of per-project knobs from `package.json["debug-gui"]` and from `package.json.mocha`. Today the GUI only exposes **one** of them — `preRun` — via the inline row in the header (shipped in commits f1c7767/cbeaa22).

Everything else — `discovery.globs`, `discovery.exclude` (currently via `mocha.exclude`), `agent.idleTimeoutMs`, `cdp.port` — requires the QA user to hand-edit `package.json`. For a GUI-first tool aimed at non-technical QA, that's a gap: they can start a run but can't fix "my tests aren't showing up" or "the agent keeps timing out" without a developer.

Goal: surface the **frequently-touched** knobs in the GUI so QA can self-serve, and clean up the dual-source glob read while we're there.

## Scope (decided)

- **In**: `discovery.globs`, `discovery.exclude`, `agent.idleTimeoutMs` (plus the existing `preRun`)
- **Out** (this pass): `cdp.port`, env vars (`PORT`, `DEBUG_GUI_NO_OPEN`, `DEBUG_GUI_CHROME_PATH`), CLI args, hardcoded window size — these stay in package.json / env for advanced users.

## Design decisions

### Storage / source of truth
- Single authoritative location: `package.json["debug-gui"].discovery.{globs,exclude}` and `package.json["debug-gui"].agent.idleTimeoutMs`.
- **One-time migration**: when `loadConfig()` sees a `package.json.mocha.exclude` but no `debug-gui.discovery.exclude`, it copies the value into `discovery.exclude` in memory. The migration persists to disk the **next time the user saves settings via the GUI** — we do not silently rewrite `package.json` on read.
- After the next save, the server reads `discovery.exclude` only. `mocha.exclude` is left in place (it may still be used by external mocha invocations), but debug-gui stops consulting it.

### UX
- **Gear icon** added to the header row, right of the Stop/status block.
- Click opens a modal `SettingsDialog` (ef-dialog) with three sections:
  1. **Test discovery** — editable list of globs (text field + Add/Remove buttons). Phase 2 adds an ef-tree-based picker behind a "Browse..." button that writes into this list.
  2. **Ignore patterns** — same shape; editable list of exclude globs.
  3. **Agent idle timeout** — numeric input in **minutes** (stored as ms). Default 10.
- **Save / Cancel** buttons. No live-apply — safer against misclicks. Save writes via the existing `settings_update` WS command, reloads config, triggers `config_updated` broadcast, refreshes the test tree.
- Modal is disabled while state is `running` / `pre-running` / `paused`.

### Phase split
- **Phase 1 (this pass)**: plumbing + modal + text-based glob editing + idle timeout + migration. Ships something useful on its own.
- **Phase 2 (follow-up)**: `ef-tree` picker for globs, server `/api/fs/tree` endpoint, selection→glob projection function. The projection is the core design-sensitive piece — left as a user-authored function with a clear signature and test harness.

## Files to touch

### Phase 1
- `packages/debug-gui/server/src/config.ts` — add `discovery.exclude`, extend `DebugGuiConfig`, extend `ConfigPatch` (idleTimeoutMs, globs, exclude), implement migration in `loadConfig()`, extend `saveConfig()`.
- `packages/debug-gui/server/src/index.ts` — extend `settings_update` handler to accept new fields; re-run `discoverSuites` after save and broadcast refreshed suites.
- `packages/debug-gui/server/src/messages.ts` — extend `ClientCommand.settings_update` type.
- `packages/debug-gui/server/src/discovery.ts` — switch to read from `config.discovery.exclude` instead of `config.mocha.exclude`.
- `packages/debug-gui/web/src/components/SettingsDialog.tsx` — new component.
- `packages/debug-gui/web/src/App.tsx` — gear icon, wire settings modal.
- `packages/debug-gui/web/src/state/store.ts` — handle refreshed suites from `config_updated` (or new `suites_updated` event).
- Tests:
  - `server/test/config.test.ts` — migration behavior, new patch fields.
  - `server/test/discovery.test.ts` — reads from `discovery.exclude`.
  - `web/src/components/SettingsDialog.test.tsx` — new.

### Phase 2 (not this pass)
- `packages/debug-gui/server/src/fsTree.ts` — recursive readdir + ignore list; `GET /api/fs/tree`.
- `packages/debug-gui/web/src/ui/EfTree.tsx` — `createComponent` wrapper.
- `packages/debug-gui/web/src/components/TreePicker.tsx` — opens from SettingsDialog.
- `packages/debug-gui/web/src/lib/projection.ts` — **selection → globs** (user-written).

## Verification

- `npm run test -w @debug-gui/server` — config/migration/discovery unit tests green.
- `npm run test -w @debug-gui/web` — SettingsDialog renders, emits correct `settings_update` payload.
- `bash packages/debug-gui/test/smoke.sh` — ensures `/api/init` still returns config with new shape.
- Manual: start debug-gui against the WDIO fixture project, open settings, edit a glob, Save, confirm the TestTree refreshes with the new suite list.
