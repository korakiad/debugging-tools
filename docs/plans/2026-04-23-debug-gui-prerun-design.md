# Debug GUI — Pre-Run Step Design

**Date:** 2026-04-23
**Status:** Approved (brainstorming)
**Owner:** QA tooling team
**Supersedes:** nothing — additive to `2026-04-20-debug-gui-design.md`

## Problem

Many QA projects require a build step (`npm run build`) before their E2E
suite can run — the tests hit a bundled app on disk or served from a dist
folder. Today the debug-gui has no notion of this: QA must drop to a
terminal, run `npm run build`, come back, then click Start. Forgetting the
build leads to confusing "test fails, why?" moments where the actual cause
is stale build output.

QA wants a one-click experience. They also want the configured command
visible in the GUI (not hidden in `package.json`) so they can see what's
about to run and save a new value without hand-editing files.

## Goals

- **One-click Start** — pre-run build runs automatically before the mocha
  walkthrough, with its output streaming into the existing log panel.
- **Configure from the GUI** — QA sees the current command in the header,
  edits it inline, clicks Save. Server persists to `package.json`.
- **Safe default** — if `preRun` is unset, the row disappears; nothing
  changes for projects that don't need a build step.
- **Escape hatch** — a per-session "Skip this run" checkbox for when QA
  knows the build is fresh. Unchecks on reload so the default is safe.

## Non-goals

- No panel of all `package.json` scripts. Original feature request was
  reduced to the actual need: one configurable pre-run command.
- No array of multiple pre-run commands. Confirmed single string.
- No walkthrough hook injection for the pre-run command — it's a build,
  not a test.
- No separate "Build" button. Auto-on-Start + Skip checkbox covers both
  workflows (rebuild each run, or skip when known fresh).
- No in-GUI editor for the other `debug-gui` config fields (CDP port,
  discovery globs, idle timeout). Dev-side concerns, stay in
  `package.json`.

## Architecture

### Config shape

Consumer's `package.json` gets one new optional key under the existing
`debug-gui` bucket — same pattern as `cdp`, `discovery`, `agent`:

```json
{
  "debug-gui": {
    "preRun": "npm run build"
  }
}
```

Value is a string. Absent / empty → feature disabled. `config.ts`
`DebugGuiConfig` gains `preRun?: string`, loaded from
`pkg["debug-gui"].preRun`.

### GUI surface

One new row in the existing App header, rendered only when the feature is
enabled OR the user is explicitly configuring for the first time:

```
[Start]  [Stop]  Pre-run: [ npm run build            ] [Save]  ☐ Skip   Status: idle
```

- Text input is pre-filled from `config.preRun` received on the `init`
  event.
- `Save` is enabled only when the input differs from the saved value.
- Start is disabled while the input is dirty (prevents "ran old value
  because I forgot to Save").
- `Skip this run` is a per-session checkbox stored in `localStorage`,
  reset on reload.
- Empty input + Save → writes `""`; server treats empty as "feature off"
  and removes the key from `package.json` on write.

### Server endpoints

One new WS client command on the existing hub (no new HTTP route —
plan Task 6 collapsed this onto the WS protocol for consistency with
`run`, `cancel`, `continue` etc. which all travel the same channel):

- `settings_update` (client → server) — body `{ preRun: string }`.
  Server reads `package.json` at `cwd`, sets/removes `debug-gui.preRun`,
  writes back preserving indent, re-loads config, and broadcasts
  `{ type: "config_updated", config }` so any other open tabs reflect
  the change.

### Run flow with pre-run

Extend the existing `{ type: "run", spec }` WS command to
`{ type: "run", spec, skipPreRun?: boolean }`. Orchestrator logic:

1. If `config.preRun` is non-empty AND `skipPreRun` is false:
   - Emit `status = "pre-running"` (new state) + `mocha_log` events
     tagged with the pre-run prefix.
   - Spawn the command via `shell: true` (so the string parses as a
     shell command), inherit env.
   - Stream stdout/stderr into the existing `MochaLogPanel` using the
     same `mocha_log` event type — the panel already handles arbitrary
     text; a small prefix `[pre-run]` is enough to distinguish.
   - Wait for exit. Exit 0 → continue to mocha. Non-zero → emit `error`
     event with the failing command + exit code, set status back to
     `idle`, do not spawn mocha.
2. Stop button during pre-run calls the existing `killTree` on the
   pre-run pid. Idempotent, same code path as stopping mocha.
3. If pre-run is absent or skipped → go straight to the existing
   walkthrough flow, unchanged.

### State machine addition

`SessionSnapshot["state"]` gains `"pre-running"`. Valid transitions:
- `idle → pre-running` (on Start with preRun configured)
- `pre-running → running` (pre-run exited 0, mocha spawned)
- `pre-running → idle` (pre-run failed or Stop clicked)

## Data flow

```
QA types "npm run build" + clicks Save
  → ws.send({type:"settings_update", preRun})
  → server: writes package.json, reloads config
  → ws.broadcast({type:"config_updated", config})
  → store updates, input shows saved value, Save disabled

QA clicks Start (Skip unchecked)
  → ws.send({type:"run", spec, skipPreRun:false})
  → orchestrator.run():
      if config.preRun && !skipPreRun:
        status = "pre-running"
        exitCode = await spawnPreRun(config.preRun)
        if exitCode !== 0: emit error, status = "idle", return
      status = "running"
      [existing mocha+walkthrough flow]
```

## Error handling

- **`package.json` missing or malformed on Save** — server returns 500
  with a message; UI shows the error banner; input stays dirty so QA can
  retry or fix the file manually.
- **Pre-run command not found (ENOENT)** — exit code non-zero; error
  banner shows "Pre-run failed: command not found". Common case on
  machines without Node on PATH.
- **Pre-run takes forever** — existing Stop button kills it (tree-kill).
  No new timeout; dev team's build is dev team's problem.
- **`preRun` written but `npm` not available in the server's PATH** —
  surfaced as ENOENT above. Documented in the README.

## Testing

Server unit tests (Vitest, existing framework):
- `config.ts` — parses `preRun` from package.json; returns undefined when
  missing; returns undefined when `""`.
- `orchestrator` — pre-run exit 0 proceeds to mocha; pre-run non-zero
  aborts and emits error; skipPreRun true bypasses; missing preRun runs
  mocha directly.
- Settings endpoint — writes package.json preserving unrelated keys and
  indent; removes the key when value is empty; broadcasts
  `config_updated`.

Web unit tests (Vitest + @testing-library/react):
- Pre-run row renders when `config.preRun` is set or feature is being
  configured; hidden otherwise.
- Save disabled when input equals saved value.
- Start disabled when input is dirty.
- Skip checkbox state lives in localStorage and resets on mount.

Smoke test addition — extend `test/smoke.sh` to:
1. Launch server against a temp project with `preRun: "echo pre-run-ok"`.
2. POST to `/api/settings` with a new value.
3. Read `package.json` back and assert the new value is present.

## Files touched

- `packages/debug-gui/server/src/config.ts` — add `preRun?: string`;
  add `saveConfig(cwd, patch)` helper that reads, merges, writes.
- `packages/debug-gui/server/src/messages.ts` — extend `run` command
  with `skipPreRun?: boolean`; add `config_updated` server event; add
  `settings_update` client command (or use HTTP `POST /api/settings`).
- `packages/debug-gui/server/src/server.ts` — mount `POST /api/settings`;
  wire `settings_update` WS command if we prefer WS.
- `packages/debug-gui/server/src/orchestrator.ts` — pre-run step;
  `pre-running` state; error path.
- `packages/debug-gui/server/src/runner.ts` — export a
  `spawnShellCommand(cmd, env, onStdout, onStderr)` helper; reuse
  `killTree`.
- `packages/debug-gui/server/src/session.ts` — extend
  `SessionSnapshot["state"]` with `"pre-running"`.
- `packages/debug-gui/web/src/App.tsx` — pre-run row (input, Save, Skip).
- `packages/debug-gui/web/src/state/store.ts` — expose `config.preRun`,
  track dirty input state, localStorage for Skip, handle
  `config_updated` event.
- Tests per "Testing" section above.

Rough size: ~60 lines server, ~30 lines web, ~80 lines tests.

## Rollout

Single PR. Existing projects without `preRun` see no change (row hidden,
run flow unchanged). Projects that opt in get the new behavior as soon
as they set a value in the GUI.
