# Hypothesis-First Prompts — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every manual-mode `ask_user` prompt in the walkthrough skill surface the agent's working hypothesis and explicitly invite QA to add context the agent can't see.

**Architecture:** Two pure prompt/UI changes. (1) Update `SKILL.md` — Manual mode contract gains a `summary` format rule (hypothesis + invitation), `allowFreeText` becomes mandatory, and a new "hypothesis revision" rule fires when QA's free text adds new context. (2) Update `PromptPanel.tsx` textarea placeholder so the invitation is visually reinforced. No schema, server, or hook changes.

**Tech Stack:** Markdown (SKILL.md), TypeScript + React + Vitest + @testing-library/react (PromptPanel).

**Design doc:** `docs/plans/2026-05-05-hypothesis-prompts-design.md`

---

## Task 1: Update `PromptPanel.tsx` placeholder (TDD)

**Files:**
- Test: `packages/debug-gui/web/src/components/PromptPanel.test.tsx`
- Modify: `packages/debug-gui/web/src/components/PromptPanel.tsx:57`

**Step 1: Add the failing test**

Append a new test to the existing `describe("PromptPanel", ...)` block in `PromptPanel.test.tsx`:

```tsx
it("textarea placeholder invites QA to add missing context", () => {
    render(<PromptPanel {...baseProps} allowFreeText={true} onRespond={() => {}} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.placeholder).toMatch(/มองข้าม|missing|miss/i);
});
```

The regex tolerates either Thai or English placeholder copy, so re-translation later doesn't break the test. The point of the assertion is *intent* (invite missing context), not the exact string.

**Step 2: Run test to verify it fails**

Run: `npm run test -w @debug-gui/web -- PromptPanel`

Expected: FAIL on the new case — current placeholder is `"Add notes (optional)…"` which does not match the regex.

**Step 3: Update the placeholder**

Edit `packages/debug-gui/web/src/components/PromptPanel.tsx:57`:

```tsx
placeholder="มีอะไรที่ผมอาจมองข้ามไหม? (optional)"
```

**Step 4: Run test to verify it passes**

Run: `npm run test -w @debug-gui/web -- PromptPanel`

Expected: All PromptPanel tests pass (6 cases, including the new one).

**Step 5: Run web build to verify no TS regressions**

Run: `npm run build -w @debug-gui/web`

Expected: Build succeeds with no TS errors.

**Step 6: Commit**

```bash
git add packages/debug-gui/web/src/components/PromptPanel.tsx packages/debug-gui/web/src/components/PromptPanel.test.tsx
git commit -m "feat(debug-gui): invite missing-context input on PromptPanel placeholder"
```

---

## Task 2: Update `SKILL.md` — Manual mode contract + Error Pattern table

**Files:**
- Modify: `packages/debug-gui/.claude/skills/walkthrough/SKILL.md`

This task has no automated test — the contents are agent instructions, not code. Verification is by review and Task 3 smoke test.

**Step 1: Replace Error Pattern table with hypothesis-bearing phrasings**

Locate the Error Pattern table (currently around lines 109–117). Replace each row's "Agent asks" cell so the question carries an embedded hypothesis. Suggested copy:

| Error Pattern | Agent asks |
|---|---|
| `element not found` / `no such element` | "ผมว่า selector ผิด หรือไม่ก็หน้ายังโหลดไม่เสร็จ — อยากชี้ element ที่ถูกให้ผมไหม? หรือบอกผมว่าหน้านี้ปกติต้องผ่านอะไรก่อน" |
| `element not interactable` / `not clickable` | "ผมว่า element ถูกบัง (modal/overlay) หรือยัง disabled — มีอะไรที่ปกติต้องปิดก่อนไหม? หรืออยากชี้ element ที่ถูก" |
| `timeout` / `waitUntil` / `waiting for` | "ผมว่าหน้ายังโหลดไม่เสร็จ หรืออาจอยู่หน้าผิด — ตอนนี้บนจอเห็นอะไร? และมี step ที่ปกติต้องทำก่อนถึงหน้านี้ไหม" |
| `stale element reference` / `StaleElementReferenceError` | "ผมว่า DOM เปลี่ยนระหว่างที่ test กำลังคลิก (reload/re-render) — เห็นจอกระพริบหรือ refresh ไหม? เพิ่งแก้ component อะไรหรือเปล่า" |
| `AssertionError` / `expected` / `assert` | "ผมว่า assertion อ่าน element ผิดตัว หรือค่าจริงต่างจากที่คาด — อยากชี้ element ที่ควรถือค่านั้นให้ผมไหม? หรือบอกได้ว่าค่าควรเป็นอะไร" |
| `navigation` / `ERR_` / `net::` | "ผมว่าหน้าผิด — อาจ redirect ผิดทาง หรือต้อง login ก่อน. ตอนนี้เห็นหน้าอะไร และปกติต้อง login ก่อนถึง flow นี้ไหม" |
| `frame` / `iframe` / `switchToFrame` / `contentFrame` | "ผมว่า element อยู่ใน iframe — ชี้ให้ผมหน่อยจะได้ frame chain ครบ. หรือบอกได้ว่าปกติเข้า iframe ตัวไหน" |
| `ECONNREFUSED` / `session not created` / `session deleted` | "ผมว่า browser ปิดหรือ crash — window ยังเปิดอยู่ไหม? เพิ่งทำอะไรกับ browser หรือเปล่า" |
| Unrecognized error | "ผม unsure ว่าเกิดอะไร — ถ้าเกี่ยวกับ element ชี้ให้ผม, หรืออธิบายว่าตอนนี้เห็นอะไรและคาดว่าควรเห็นอะไร" |

Each phrasing now leads with "ผมว่า…" (the hypothesis), then asks for picking OR for context the agent can't see. Translate to QA's working language at runtime per existing skill rule — keep the *structure* (hypothesis + invitation), not these exact strings.

**Step 2: Update Manual mode contract**

Locate the "Manual mode contract" section (currently starting around line 286). Replace items 2 and 3 with this expanded version, and add a new item 6:

```markdown
2. After **every** CDP / playwright-cli inspection step (snapshot, eval, click, screenshot), call `ask_user` with:
   - a `summary` formatted as **two lines**:
     - **Hypothesis line** — "ผมคิดว่า [root cause] เพราะ [evidence จาก CDP / pick / error]"
     - **Invitation line** — "มี context อะไรที่ผมอาจมองข้ามไหม? (เช่น step ที่ปกติทำ, modal ที่ต้องปิด, เพิ่งแก้ code อะไร) — พิมพ์บอกได้เลย"
   - 2-3 `options` describing what you could do next
   - `allowFreeText: true` — **mandatory in manual mode, no exceptions**
3. Option id conventions:
   - `apply_*` — applies a fix (will call `edit_file`)
   - `pick_*` — calls `pick_element` (opens the GUI picker)
   - any other snake_case — investigation step (e.g. `investigate_modal`)
```

(Items 4 and 5 keep their existing wording about `apply_*` and `edit_file`.)

Add a new item 6 just before the "Auto mode skips…" paragraph:

```markdown
6. **Hypothesis revision rule** — when QA's `freeText` response contains information not already in your hypothesis (e.g. "the cookie modal needs to close first", "this only fails after login"):
   - Acknowledge the new context explicitly in your next message ("Got it — there's a cookie modal first")
   - **Re-investigate** if the new context invalidates prior CDP findings (e.g. snapshot a different selector, check a different page state)
   - Restate the **revised hypothesis** before calling `ask_user` again or proposing a fix
   - Do NOT silently fold new context into an existing fix proposal — QA needs to see that you understood what they told you
```

**Step 3: Verify no markdown syntax breakage**

Run: `node -e "require('fs').readFileSync('packages/debug-gui/.claude/skills/walkthrough/SKILL.md', 'utf8')"`

Expected: No error. (Sanity check; the file must still be readable text.)

**Step 4: Verify the file still passes any project lint**

Run: `npm run build -w @debug-gui/server && npm run build -w @debug-gui/web`

Expected: Builds succeed. (SKILL.md isn't compiled, but this confirms we didn't accidentally edit a TS file.)

**Step 5: Commit**

```bash
git add packages/debug-gui/.claude/skills/walkthrough/SKILL.md
git commit -m "feat(walkthrough): hypothesis-first ask_user prompts in manual mode"
```

---

## Task 3: Manual smoke verification

**Files:** none modified. This is verification, not implementation.

**Step 1: Build everything**

Run: `npm run build -w @debug-gui/server && npm run build -w @debug-gui/web`

Expected: Both builds succeed.

**Step 2: Launch the debug GUI**

Run: `node packages/debug-gui/bin/debug-gui.js`

Open the GUI URL printed to stdout in a browser.

**Step 3: Run a failing fixture in manual mode**

Configure the GUI to run `test/walkthrough-e2e-wdio/login.spec.js` (this fixture has 3 intentionally wrong selectors). Set agent mode to **manual** in the GUI.

Click Run. Wait for the first failure to pause the run.

**Step 4: Verify the prompt format**

In the chat drawer, the agent's first `ask_user` after the failure must contain:
- A "ผมคิดว่า…" / "I think…" hypothesis line referencing what the agent observed
- An invitation line ending with something like "พิมพ์บอกได้เลย" / "tell me below"
- Visible options (at least one `pick_*` or `investigate_*`)
- A textarea with placeholder containing "มองข้าม" or "missing"

If any of those is missing, return to Task 1 or Task 2 and tighten the relevant rule.

**Step 5: Verify hypothesis revision**

In the textarea, type a context fact the agent could not have known, e.g. `"There's a cookie banner that always shows first on this page"`. Click Send.

The agent's next message must:
- Acknowledge the new context explicitly
- Either re-investigate (new CDP call visible in activity) or revise the hypothesis before proposing a fix

If the agent silently proposes a fix without acknowledging, the `Hypothesis revision rule` (Task 2 step 2 item 6) is too weak — strengthen the wording and re-test.

**Step 6: No commit**

Smoke verification produces no artifact. If everything passes, the implementation is done. If something fails, loop back to the relevant task.

---

## Done criteria

- All Task 1 unit tests pass.
- Task 2 SKILL.md changes are committed and reviewable.
- Task 3 smoke run shows: hypothesis + invitation in summary, mandatory free-text textarea with new placeholder, agent acknowledges new context from free text before fixing.
- No regression in existing walkthrough flow (auto mode untouched, `ask_user` schema unchanged, existing PromptPanel tests still pass).
