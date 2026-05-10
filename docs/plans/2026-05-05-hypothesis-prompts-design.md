# Hypothesis-First Prompts in the Walkthrough Skill

**Date:** 2026-05-05
**Status:** Approved (design)
**Scope:** `packages/debug-gui/.claude/skills/walkthrough/SKILL.md`, `packages/debug-gui/web/src/components/PromptPanel.tsx`

## Problem

When a walkthrough test fails, the agent inspects the live DOM via CDP, picks a hypothesis, and asks QA to choose between A/B/C options. But many real-world failures have a **root cause the agent cannot see from the DOM alone** — for example:

- Element exists but is hidden behind a modal QA usually dismisses first
- Code forgot a prerequisite action (e.g. login, accept-cookies)
- Recent code change altered an unrelated screen state
- Animation/transition timing the test doesn't account for

The current `ask_user` tool already exposes `allowFreeText: true`, so QA *can* type extra context. But the prompt doesn't actively invite it, and QA usually just clicks one of the offered options. The agent's hypothesis goes unchallenged, the fix targets a symptom, and the same failure recurs in the next run.

## Goal

Every `ask_user` call in manual mode should:

1. Surface the agent's **working hypothesis** ("I think this is happening because X, based on Y")
2. Explicitly **invite QA to fill in context the agent can't see**
3. Make the free-text input visually inviting, not an afterthought

When QA volunteers new context, the agent must **revise the hypothesis** before proposing a fix — not append it to an already-formed plan.

## Non-goals

- **Auto mode is unchanged.** Auto mode skips `ask_user` gating by design; users who want this dialog choose manual mode.
- **No schema change to `ask_user`.** The tool's `summary` field already accepts free-form text; we don't need a structured `hypothesis` field yet. If model drift makes the format unreliable in practice, we revisit.
- **No backend changes.** Server, hooker, and orchestrator stay as-is.

## Design

### Prompt structure (in `summary`)

The agent formats the `summary` argument as two short lines:

```
[Hypothesis] ผมคิดว่า <root-cause> เพราะ <evidence>
[Invitation] มี context อะไรที่ผมอาจมองข้ามไหม? (เช่น step ที่ปกติทำ, modal ที่ต้องปิด, เพิ่งแก้ code อะไร) — พิมพ์บอกได้เลย
```

(Phrasing translates to QA's working language at runtime, per existing skill rule.)

`allowFreeText` is **always** `true` in manual mode — no longer up to the agent.

### Hypothesis revision rule

When QA's `freeText` response contains new information not already in the agent's hypothesis, the agent MUST:

1. Acknowledge the new context explicitly ("Got it — there's a cookie modal first")
2. **Re-investigate** if the new context invalidates prior CDP findings
3. Restate the revised hypothesis before proposing a fix

The agent must not silently fold new context into an existing fix proposal.

### Error Pattern table refresh

The existing table maps errors to questions. Refresh each row so the question carries the embedded hypothesis. Example:

| Error Pattern | Old phrasing | New phrasing |
|---|---|---|
| `element not found` | "Can't find that element — want to pick the correct one?" | "ผมว่า selector ผิด หรือไม่ก็หน้ายังโหลดไม่เสร็จ — อยากชี้ element ที่ถูกให้ผมไหม? หรือบอกผมว่าหน้านี้ปกติต้องผ่านอะไรก่อน" |
| `element not interactable` | "Element isn't clickable — want to pick the one you actually want first?" | "ผมว่า element ถูกบัง (modal/overlay) หรือยัง disabled — มีอะไรที่ปกติต้องปิดก่อนไหม? หรืออยากชี้ element ที่ถูก" |

(Full table is part of implementation, not design.)

### UI nudge

`PromptPanel.tsx` textarea placeholder changes from:

```
Add notes (optional)…
```

to:

```
มีอะไรที่ผมอาจมองข้ามไหม? (optional)
```

This is the only frontend change. It reinforces the invitation visually for QA who skim the summary.

## Architecture impact

None. The change is:
- 1 SKILL.md edit (Manual mode contract + Error Pattern table phrasings + new "hypothesis revision" rule)
- 1 placeholder string edit in `PromptPanel.tsx`
- No data shape, schema, server, or hook changes

## Testing

- **Unit:** `PromptPanel.test.tsx` — assert the new placeholder text renders.
- **Integration:** `askUser.integration.test.ts` — no change needed; the schema is unchanged.
- **Manual smoke:** Run a failing test in walkthrough manual mode, confirm the agent's `summary` includes both hypothesis and invitation lines, confirm placeholder is updated.
- **No agent-output regression test.** Prompt-rule adherence is enforced by SKILL.md instructions, not by code; testing it would require pinning the model.

## Tradeoffs

**Pro**
- Smallest possible blast radius: 1 doc + 1 string.
- Reversible: revert two files to roll back.
- No schema migration → no risk to existing manual-mode and auto-mode flows.

**Con**
- Format adherence depends on the agent following SKILL.md. If we observe drift (agent collapses summary to one line, omits invitation), we add a structured `hypothesis` field to the `ask_user` schema and render it as a separate row in `PromptPanel`.

## Out of scope (future work)

- Structured `hypothesis` field on the `ask_user` tool (only if drift observed).
- Auto-mode equivalent: a non-blocking "did I miss anything?" toast that QA can dismiss without pausing the agent. Ship only if requested.
- Multi-turn context refinement (agent asking follow-up clarifying questions when QA's free text is ambiguous). The existing rephrase-rules already cover unclear responses.
