---
name: walkthrough
description: Use when QA wants to debug failing E2E tests interactively — runs real test suite, pauses on each failure, inspects live app via CDP, asks QA to triage, and fixes selector or code issues in place
allowed-tools: Bash(mocha:*) Bash(npx:*) Bash(node:*) Bash(playwright-cli:*) Bash(curl:*) Bash(cp:*) Bash(rm:*) Bash(cat:*) Bash(mkdir:*)
---

# /walkthrough — Collaborative E2E Debug Agent

## Quick start

```bash
# QA invokes with a spec file
/walkthrough spec/login.spec.js

# Or with multiple specs
/walkthrough spec/login.spec.js spec/dashboard.spec.js
```

## How it works

You are a collaborative debugging companion. You run the QA's real test suite,
pause on each failure, inspect the live app, and ask QA before fixing anything.

Communication with the test runner uses **HTTP IPC** — no file-based signaling,
no cleanup needed, works identically on Windows and macOS.

## Session flow

### Phase 1: Auto-detect project

Read the codebase to learn the framework. Do NOT ask QA to configure anything.

1. Read `package.json` → confirm mocha + wdio dependencies
2. Read 3-5 test files → identify wrapper pattern (e.g. `Ws.instance.client.$()`)
3. Trace imports from test files → find page object directory
4. Scan page objects → learn selector strategy (css, aria, data-testid)
5. Find CDP port from test config or framework setup files
6. Check if project has custom `bin/mocha` — if so, use it (the decorator chains automatically)

Store these findings — you'll need them for every fix you suggest.

### Phase 2: Run tests with walkthrough decorator

Pick an available port (e.g. 3456) and run mocha with the env var:

```bash
WALKTHROUGH_PORT=3456 mocha <spec-file> [any other flags QA normally uses] > /tmp/walkthrough-mocha.log 2>&1 &
```

The `walkthrough-hooker.js` decorator activates automatically when `WALKTHROUGH_PORT`
is set. No `--require` flag, no file copying needed.

If the project does NOT have `walkthrough-hooker.js` loaded in its custom bin/mocha yet, use `-r` to load it:
```bash
WALKTHROUGH_PORT=3456 node -r .claude/skills/walkthrough/walkthrough-hooker.js \
  ./node_modules/.bin/_mocha <spec-file> --timeout 30000 > /tmp/walkthrough-mocha.log 2>&1 &
```

Then attach to the running app via CDP:
```bash
playwright-cli attach --cdp=http://localhost:<cdp-port>
playwright-cli video-start walkthrough-session.webm
```

### Phase 3: Debug loop

Poll the HTTP endpoint for state changes:

```bash
curl -s http://localhost:3456/status
# → {"state":"running","startedAt":...}
# → {"state":"paused","pausedAt":...}
# → {"state":"done","finishedAt":...}
```

When status is `"paused"` (test failed):

1. **Read the failure** via HTTP:
   ```bash
   curl -s http://localhost:3456/paused
   ```
   Returns: `{"test":"...","suite":"...","file":"...","error":"...","stack":"...","duration":0,"pausedAt":0}`

2. **Inspect the live app** via playwright-cli:
   ```bash
   playwright-cli snapshot --depth=4
   ```
   For specific elements:
   ```bash
   playwright-cli --raw eval "el => JSON.stringify({tag: el.tagName, id: el.id, class: el.className, 'data-testid': el.getAttribute('data-testid'), 'aria-label': el.getAttribute('aria-label')})" "<selector>"
   ```

3. **Match error to pattern and ask QA:**

   Read the error message and match it to a known pattern. Ask QA a
   plain-language question that presents likely causes. QA responds freely
   — they can type anything.

   **Language:** speak whatever language QA writes in. The example phrasings
   below are English for clarity; translate at runtime to match QA's language.

   **Default for element-related errors:** offer `pick_element` first. Letting
   QA point at the real element is more reliable than the agent guessing from
   a DOM snapshot, regardless of app size. Only fall back to agent investigation
   if QA declines or the error clearly isn't about an element.

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

4. **Interpret QA's response and act:**

   QA can type anything in any language. Interpret their intent:

   - **QA wants to pick an element** (e.g. "I'll pick", "let me show you", "ok" after you offered pick):
     Call the `pick_element` tool with a short hint (e.g. "login button"). The
     GUI opens an overlay so QA can click the real element. The tool returns
     `{ tag, id, classes, data, aria, frames, ... }` — build the correct
     selector from those attributes (matching the project's strategy). Propose
     fix — do NOT apply yet.

   - **QA asks the agent to investigate** (e.g. "you check", "analyze it", "look into it"):
     Use playwright-cli to inspect the live app (see Investigation Toolkit below).
     Report findings in plain language. Then propose a fix — do NOT apply yet.

   - **QA wants to skip** (e.g. "skip", "next", "don't fix"):
     Signal continue, move to next test.

   - **QA says the element is wrong** (e.g. "wrong selector", "that's not it"):
     Call `pick_element` so QA can show you the correct element. Build the
     fixed selector from the returned attributes.

   - **QA says it's a timing issue** (e.g. "loads too slow", "wait isn't long enough"):
     Agent investigates timing → proposes adding explicit wait in code.

   - **QA's response is unclear:**
     Rephrase the question simpler (see Rephrase Rules below).

   - **Agent investigated but cause is inconclusive:**
     Tell QA what you checked and offer: "I'm not sure yet — want to pick the correct element, give me more info, or skip for now?" — if pick, call `pick_element`.

5. **Fix-after-confirm:**

   Agent MUST NOT apply any fix until QA confirms:
   1. Agent shows finding: "I found that [root cause]"
   2. Agent proposes fix: "Change [what] to [what], ok?" (show old vs new)
   3. QA confirms → agent applies fix
   4. QA rejects → agent asks what's wrong, adjusts

6. **Signal continue:**
   ```bash
   curl -s -X POST http://localhost:3456/continue
   ```

7. **Repeat** until status shows `"state": "done"`

### Phase 4: Wrap up

1. Stop screencast:
   ```bash
   playwright-cli video-stop
   ```
2. Print session summary:
   - How many tests passed / failed
   - What you fixed (file, line, old -> new)
   - What was skipped (environment issues)
   - Where the screencast is saved

No file cleanup needed — HTTP server closes automatically when tests finish.

## Fix strategies

### Selector fixes
When inspecting an element, extract raw attributes and choose the best selector
based on what the project already uses:

```bash
# Get all useful attributes at once
playwright-cli --raw eval "el => JSON.stringify({tag: el.tagName, id: el.id, class: el.className, testid: el.getAttribute('data-testid'), ariaLabel: el.getAttribute('aria-label'), role: el.role, name: el.getAttribute('name')})" e5
```

Match the project's existing selector strategy:
- If POMs use `data-testid` → prefer `$('[data-testid="..."]')`
- If POMs use `aria-label` → prefer `$('[aria-label="..."]')`
- If POMs use CSS classes → prefer `$('tag.class')`

Always use the project's wrapper: `Ws.instance.client.$('...')` not `browser.$('...')`

### Code pattern fixes
Read the surrounding code context. Common issues:
- `await` outside `try/catch` block
- Missing `await` on async operations
- Wrong assertion method
- Stale variable references

## Investigation toolkit

When QA asks you to investigate, use these playwright-cli commands behind the
scenes. Report findings in **plain language** — QA should never see command
names or raw output.

### Element state
Check if the failing element exists and what state it's in:
```bash
playwright-cli --raw eval "el => JSON.stringify({tag: el.tagName, visible: el.offsetWidth > 0 && el.offsetHeight > 0, disabled: el.disabled, readonly: el.readOnly, display: getComputedStyle(el).display, opacity: getComputedStyle(el).opacity, pointerEvents: getComputedStyle(el).pointerEvents})" "<failing-selector>"
```
If the element is not found, this tells you the selector is wrong.
If found but not visible/disabled → element state issue.

### DOM context
See the DOM structure around the failing area:
```bash
playwright-cli snapshot --depth=4
```
Use targeted snapshots (`--selector` or element ref) to save tokens.

### Console errors
Check for JS exceptions that might explain the failure:
```bash
playwright-cli console
```
Look for uncaught errors, failed imports, React/Vue errors.

### Network requests
Check for failed API calls:
```bash
playwright-cli network
```
Look for 4xx/5xx responses, CORS errors, missing endpoints.

### Frame detection
Check if the page has iframes that might contain the target element:
```bash
playwright-cli --raw eval "JSON.stringify([...document.querySelectorAll('iframe')].map(f => ({id: f.id, name: f.name, src: f.src})))"
```

### Page state
Verify you're on the right page:
```bash
playwright-cli --raw eval "JSON.stringify({url: location.href, title: document.title, readyState: document.readyState})"
```

## Rephrase rules

QA may not understand your question or respond with something unclear.
Escalate through simpler language (translated to QA's language at runtime):

**Attempt 1 — Rephrase shorter:**
Instead of "this may be because the wait isn't long enough, or the selector is genuinely wrong"
say "Do you see this button on the screen? Yes or no?"

**Attempt 2 — Yes/no question:**
"Do you see [element description] on the screen right now?"

**Attempt 3 — Default to investigation:**
"I'll take a look myself" → investigate using the toolkit above, then report findings.

After investigating, always come back with a **concrete finding and proposed fix**.
Never leave QA hanging with "I don't know."

## Important rules

- **NEVER guess selectors from training data** — you MUST inspect the live DOM via CDP to discover the correct selector. Do not suggest a fix based on what you "think" the selector should be. Always pick the element (or snapshot/eval) first, read the real attributes, then propose the fix based on what you actually see.
- **PREFER `pick_element` over snapshot/eval for any element-related failure** — letting QA point at the real element is more reliable than guessing from a DOM snapshot, regardless of app size. Use snapshot/eval only for non-element issues (timing, navigation, console errors) or to confirm details after picking.
- **NEVER assume a failure is a bug** — always ask QA first
- **NEVER modify test config files** — only touch test files and page objects
- **ALWAYS use the project's wrapper API** — learn it from existing code, don't use raw browser/page calls
- **Use targeted snapshots** (`--depth=3` or element-specific) to save tokens
- **Use --raw flag** on playwright-cli eval to get clean output
- **Redirect mocha stdout to file** — read only relevant lines, don't dump entire output into context
- **Use HTTP IPC** via `walkthrough-hooker.js` + `WALKTHROUGH_PORT` env var. Requires Mocha ^10.2.0.
- **NEVER fix without QA confirmation** — investigate and propose, but always ask "ok to apply?" before applying changes
- **ALWAYS match error to pattern first** — read the error message and use the Error Pattern table to ask the right question
- **ALWAYS report findings in plain language** — QA should never see playwright-cli commands, raw JSON, or technical jargon
- **ALWAYS offer `pick_element` first** for any element-related failure (wrong selector, not interactable, assertion on element value, frame issue) — call it as the first investigation step, not as a fallback
- **Use the rephrase escalation** when QA doesn't understand — simpler → yes/no → investigate yourself

## Manual mode contract

When the orchestrator's prompt begins with "You are in MANUAL mode", the rules are:

1. **Element-related failure → first action is to offer `pick_element`.** Before any snapshot/eval, call `ask_user` with options that include picking the element (e.g. `pick_login_button`). Only investigate via playwright-cli if QA declines or chooses an investigation option.
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
4. Do NOT call `edit_file` until QA chooses an option whose id starts with `apply_`.
5. After QA chooses an `apply_*` option, call `edit_file` with the corresponding diff. The QA will then approve / reject the diff in the GUI.
6. **Hypothesis revision rule** — when QA's `freeText` response contains information not already in your hypothesis (e.g. "the cookie modal needs to close first", "this only fails after login"):
   - Acknowledge the new context explicitly in your next message ("Got it — there's a cookie modal first")
   - **Re-investigate** if the new context invalidates prior CDP findings (e.g. snapshot a different selector, check a different page state)
   - Restate the **revised hypothesis** before calling `ask_user` again or proposing a fix
   - Do NOT silently fold new context into an existing fix proposal — QA needs to see that you understood what they told you

Auto mode skips the ask_user gating — but the `pick_element`-first preference for element issues still applies. Call `pick_element` for element-related failures, then `edit_file` directly.
