# Debug GUI — Agent Auto/Manual mode + `ask_user` interactive prompt tool

## Context

Today, when a mocha test pauses on failure, the debug-gui agent investigates autonomously via playwright-cli (CDP) and proposes a single fix through `edit_file`. QA sees a `DiffView` with binary Approve/Reject. The only way QA can steer mid-investigation is the chat drawer, and the only way the agent can "wait for QA" is the agent-idle timeout — a coarse mechanism that conflates "QA is reading" with "agent is hung."

We want two things:

1. **Manual mode** — agent collaborates step-by-step with QA. After each CDP/playwright-cli inspection, it surfaces a short summary plus 2–3 suggested next actions as buttons; QA can click an option or type a free-form prompt. The agent does not edit files until QA explicitly chooses an "apply this fix" option.
2. **Auto mode** — current behavior: agent investigates and applies fixes through `edit_file` directly. The new `ask_user` tool is available but the agent is told to use it only when truly stuck.

Underlying both: a structured, blocking `ask_user` tool that replaces ad-hoc waits with an explicit "agent is awaiting QA input" state.

## Scope (decided)

- **In**: new agent tool `ask_user(summary, options[], allowFreeText)` returning `{ choice, freeText }`.
- **In**: new web component `PromptPanel` rendered alongside `DiffView` when an `ask_user` request is pending.
- **In**: `agent.mode: "auto" | "manual"` config, persisted in `debug-gui` block of consumer's `package.json`. Default `"auto"`.
- **In**: toolbar `ModeToggle` next to ⚙. Disabled while `running` / `pre-running` / `paused` (mode change applies to the next pause / next message).
- **In**: mode-conditional preamble injected into the prompt the orchestrator sends to the agent on `paused`.
- **In**: small skill update so agent understands the manual-mode contract.
- **Out**: per-hunk diff approval (already out of scope — see `2026-04-28-pierre-diff-viewer-design.md`).
- **Out**: replacing `pick_element` or `edit_file` — they keep working unchanged in both modes.
- **Out**: A multi-turn conversational primitive for `ask_user` (one tool call = one question = one response; the agent calls it again for follow-ups).

## Architecture

Three additions to the existing debug-gui:

1. **Mode flag** — `config.agent.mode: "auto" | "manual"` in `debug-gui.config.json` (in `package.json`'s `debug-gui` block). Default `"auto"`. Toolbar toggle in `App.tsx` sends `settings_update`. The mode is read at the moment a paused-failure prompt is built; switching mode mid-pause does not retroactively rewrite a request already in flight.
2. **New agent tool `ask_user`** — registered alongside `edit_file` and `pick_element` in `index.ts`. Same `Promise + Map<reqId, resolver>` shape. Available in **both** modes — auto mode just doesn't strongly encourage its use.
3. **Prompt directive** — the per-pause prompt in `index.ts` (currently built inside the `onChange` handler) gets a small mode-conditional preamble. Manual: *"After each CDP/playwright-cli inspection, call `ask_user` with summary + 2–3 next steps. Don't call `edit_file` until QA explicitly chooses 'apply this fix'."* Auto: current behavior.

Nothing about `edit_file` / `pick_element` / `DiffView` / `PickerOverlay` changes — they keep working the same in both modes.

## Components

### Server

- **`server/src/tools/askUser.ts`** — new file, mirrors `editFile.ts`:

  ```ts
  ask_user({
    summary: string,                                // 1-line context for QA
    options: { id: string; label: string; detail?: string }[],   // 0..6
    allowFreeText: boolean,
  })
  → { choice: string | null; freeText: string | null }
  ```

  Handler awaits `deps.onAsk(summary, options, allowFreeText)`.

- **`server/src/index.ts`** — wire the tool:
  - `askResolvers: Map<reqId, resolver>`
  - `onAsk` constructs `reqId`, broadcasts `{ type: "prompt", reqId, summary, options, allowFreeText }`, returns the awaited promise.
  - Add `prompt_response` handler in `hub.onMessage`.
  - Read `config.agent.mode`; when `"manual"`, prepend the mode preamble to the `sendAndWait` prompt.

- **`server/src/messages.ts`** — extend protocol:
  ```ts
  // ServerEvent
  | { type: "prompt"; reqId: string; summary: string;
      options: { id: string; label: string; detail?: string }[];
      allowFreeText: boolean }

  // ClientCommand
  | { type: "prompt_response"; reqId: string; choice: string | null; freeText: string | null }
  ```
  Also extend the existing `settings_update` command with a top-level `mode?: "auto" | "manual"` field — keeps the flat shape that `preRun` / `idleTimeoutMs` already use.

- **`server/src/config.ts`** — extend in three places, not just one:
  1. `DebugGuiConfig.agent` gains `mode: "auto" | "manual"` (default `"auto"`).
  2. `loadConfig` reads `dg.agent?.mode`; if not `"manual"`, silently defaults to `"auto"` (mirrors existing "unknown values are silently coerced" behaviour — no `console.warn`, that would be a new pattern).
  3. `ConfigPatch` gains `mode?: "auto" | "manual"`. The patch-applier in `saveConfig` writes it via `block.agent = { ...(block.agent ?? {}), mode: patch.mode }` — same shape as the existing `idleTimeoutMs` clause. **This is the load-bearing piece — without it the toolbar toggle is a no-op.**
  4. `index.ts`'s `settings_update` handler validates `cmd.mode` is `"auto"` or `"manual"` and forwards it as `patch.mode`.

- **`server/src/agent.ts`** — `buildSessionConfig` takes a new `tools` entry; the call site in `index.ts` passes `makeAskUserTool(...)` alongside the existing two.

### Web

- **`web/src/components/PromptPanel.tsx`** — new component. Renders:
  - `summary` (top, halo-dark `EfPanel` chrome).
  - Column of option buttons (`EfButton`, one per option). Each button has `label` bold, optional `detail` muted text below.
  - Optional `<textarea>` (only when `allowFreeText`) plus a "Send" `EfButton`.
  - Clicking an option → `onRespond({ choice: option.id, freeText: textareaValue || null })`.
  - Clicking Send with empty options or just text → `onRespond({ choice: null, freeText })`.
  - Style mirrors `DiffView`: `EfPanel` with header / body / footer divisions.

- **`web/src/state/store.ts`** — add `pendingPrompt: { reqId, summary, options, allowFreeText } | null`.
  - Reducer handles incoming `prompt` event → set state.
  - On `prompt_response` send → clear state.

- **`web/src/App.tsx`** — render `<PromptPanel>` when `pendingPrompt` is set, in the same vertical region as `<DiffView>` (below `<FailureCard>`, above `<MochaLogPanel>`). Wire submit to `prompt_response` and clear local state.
  - **Stacking rule:** if both `pendingPrompt` and `pendingDiff` are set at the same time, the prompt wins (renders on top, diff hides). In manual mode the agent only ever has one in flight at a time (it's gated on `apply_*`), so this is mostly defensive — but a stale `DiffView` left over from a previous step shouldn't sit underneath a fresh question.

- **`web/src/components/ModeToggle.tsx`** — small Auto/Manual segmented toggle in the top toolbar (right of the existing buttons, left of ⚙). Sends `settings_update` with top-level `mode: "auto" | "manual"`.
  - Disabled while `state.state === "running" | "pre-running" | "paused"`. This is intentional: mode change applies to the next session, never mid-session, so QA can only toggle between runs (`idle` / `done`).

- **`web/src/components/SettingsDialog.tsx`** — **no mode field here**. Toolbar toggle is the only entry point so the two controls can't drift; adding a duplicate in the dialog is YAGNI.

### Skill

- **`packages/debug-gui/.claude/skills/walkthrough/SKILL.md`** — the **bundled** copy only. Add a "Manual mode contract" subsection: when a mode preamble is present, the agent must call `ask_user` after each inspection step, and must not call `edit_file` until an option whose `id` starts with `apply_` is chosen. The orchestrator's preamble references this section by name.
- **`.claude/skills/walkthrough/SKILL.md`** at the repo root — explicitly **not** edited. That's the standalone v1 (filesystem IPC) skill used by Claude Code CLI without the GUI; it has no `ask_user` tool and no mode toggle, so adding manual-mode guidance there would only confuse CLI users.

### Tool id convention

The `apply_*` prefix on option ids is load-bearing — the manual-mode contract gates `edit_file` on it. To keep the convention enforceable rather than prose-only, the `ask_user` zod schema constrains `option.id` to `/^[a-z][a-z0-9_]*$/` and the manual-mode preamble repeats: *"option ids that apply a fix MUST start with `apply_`."*

## Data flow

### Auto mode (paused failure)

1. Test fails → hook POSTs `/hook/paused` → orchestrator sets state `paused`.
2. `index.ts` `onChange(paused)` builds prompt **without** the manual preamble and calls `agentSession.sendAndWait(prompt, idleTimeoutMs)`.
3. Agent inspects via CDP, calls `edit_file(path, oldCode, newCode)`.
4. `editResolvers.set(reqId, resolve)` + WS `diff` → web shows `DiffView`.
5. QA Approve → `diff_decision approved` → file written → tool returns `{ applied: true }`.
6. Agent finishes message; QA hits Continue.

### Manual mode (paused failure)

1–2. Same as Auto, but prompt now starts with: *"You are in MANUAL mode. After each inspection step, call `ask_user` with a summary and 2–3 suggested next steps. Do not call `edit_file` until QA explicitly chooses an option whose id starts with `apply_`."*
3. Agent inspects via CDP, **does not** call `edit_file`. Calls:
   ```
   ask_user({
     summary: "Login button selector [data-test=login] not found. Two candidates in DOM:",
     options: [
       { id: "investigate_a", label: "Inspect [data-test='login-button']", detail: "data-test attribute, near top of form" },
       { id: "investigate_b", label: "Inspect text='Sign in'", detail: "button text in footer" },
       { id: "apply_a", label: "Apply fix using [data-test='login-button']" },
     ],
     allowFreeText: true,
   })
   ```
4. `askResolvers.set(reqId, resolve)` + WS `prompt` → web shows `PromptPanel`.
5. QA clicks "Inspect [data-test='login-button']" → `prompt_response { choice: "investigate_a", freeText: null }` → tool returns same shape to agent.
6. Agent runs further CDP inspection, then either calls `ask_user` again (loop) or — when QA chose an `apply_*` option — calls `edit_file` with the corresponding fix.
7. `DiffView` shows; QA Approve → file written → Continue.

### Mode toggle

- QA toggles Auto → Manual between runs. `settings_update { agent: { mode: "manual" } }` → `saveConfig` persists → `config_updated` broadcast → toggle reflects.
- Toggle is disabled during `running` / `paused` to prevent confusing half-state where some tool calls in a single agent message use one mode and some another.

## Error handling

- **QA dismisses prompt without choosing** — not a supported state in v1 (no Cancel button on `PromptPanel`). The panel only resolves via option click or Send. If QA wants to bail, they hit Stop (existing `cancel` flow). Re-evaluate after first manual-mode dogfooding — if QA reports they often want to dismiss a question without killing the run, add Cancel.
- **Agent abort / cancel while resolvers are pending — pre-existing leak being fixed here**. Today, `cancel` and `agent_abort` call `agentSession.abort()` but do **not** drain `editResolvers` / `pickResolvers`; those Maps hold raw `Promise` resolvers, not session refs, so they leak across sessions. This PR adds a `resetResolvers()` helper that drains all three Maps (edit / pick / ask) by rejecting each resolver with `new Error("session aborted")` and clearing the Map. Called from both `cancel` and `agent_abort`. **Flag this in the PR description as a fix to a pre-existing bug** so reviewers don't read it as an unrelated drive-by, and add a vitest regression test that creates a pending edit/pick/ask resolver, fires `cancel`, and asserts all three reject.
- **Validation** — `prompt_response.choice`, when non-null, must match one of the announced option ids; otherwise server returns an error event. Free text is unbounded but trimmed.
- **Idle timeout while QA reads** — `agent.idleTimeoutMs` (default 10 min) bounds how long `sendAndWait` will block. While the agent has an outstanding tool call (`ask_user` waiting on QA), the SDK considers the session non-idle (see `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`: idle is "session is idle with no background agents in flight"), so `sendAndWait` does not fire idle until `ask_user` returns. `idleTimeoutMs` therefore acts as a safety cap on a forgotten panel — if QA walks away for 10 minutes, the session unblocks and surfaces an idle-timeout error rather than pinning forever. No special extension required.
- **Mode mismatch** — invalid `agent.mode` value in `package.json` silently coerces to `"auto"` (matches `loadConfig`'s existing handling of unknown values; introducing `console.warn` here would be a new convention, out of scope for this PR).

## Testing

- **Unit (server)** — `tools/askUser.test.ts` mirrors `editFile.test.ts`: calls handler with a mock `onAsk` resolving to `{ choice: "a", freeText: null }`, asserts the tool returns that. Schema rejects malformed args.
- **Unit (server)** — `config.test.ts`: `agent.mode` round-trips through `loadConfig`/`saveConfig`; invalid values fall back to `"auto"`.
- **Unit (web)** — `PromptPanel.test.tsx`: renders summary, options, textarea (only when allowed); clicking an option calls `onRespond` with that id; Send with text only calls `onRespond({ choice: null, freeText })`.
- **Unit (web)** — `state/store.test.ts`: `prompt` event sets `pendingPrompt`; `prompt_response` clears it.
- **Smoke** — extend `packages/debug-gui/test/smoke.sh` only with the lightweight check: start server with `agent.mode = "manual"` config, hit `/api/init`, assert `config.agent.mode === "manual"`. Driving a WS round-trip with a mock tool inside bash is out of step with the rest of the file.
- **Server integration (vitest)** — new `server/test/askUser.integration.test.ts` covers the WS round-trip: spin up the Express + WS server with a stub `onAsk` registered, simulate a tool call, send a `prompt_response` over WS, assert the resolver fires with the expected `{ choice, freeText }`. Plus the resetResolvers regression test from the error-handling section.
- **Manual** — run `node packages/debug-gui/bin/debug-gui.js` against the saucedemo WDIO fixtures with `mode = "manual"`, verify the agent surfaces option panels and waits for QA picks instead of editing files autonomously.

## YAGNI cuts

Things considered and deliberately not in v1:

- **Multi-turn `ask_user`** — the agent gets one response per call. Follow-ups are new tool calls.
- **Rich option detail** (file diff previews inside an option button, screenshots, etc.) — kept to plain text. If we need it later, the `detail` field can carry markdown.
- **Per-failure mode override** — mode is global per session, not per pause.
- **Streaming option enrichment** — agent sends one finalized list of options; it can't update the panel after the fact (other than by issuing a new `ask_user`).
- **Cancel button on `PromptPanel`** — Stop already covers this.
