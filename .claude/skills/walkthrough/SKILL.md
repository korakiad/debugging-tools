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

   | Error Pattern | Agent asks |
   |---|---|
   | `element not found` / `no such element` | "Element หาไม่เจอ — อาจเป็นเพราะ wait ไม่ทัน หรือ selector ผิดจริงๆ คุณอยากให้ผมวิเคราะห์ selector หรือคุณ pick element เอง?" |
   | `element not interactable` / `not clickable` | "Element กดไม่ได้ — อาจเป็นเพราะ disabled อยู่หรือถูกบัง คุณอยากให้ผมดูสถานะ element หรือมันเป็น element ผิดตัว?" |
   | `timeout` / `waitUntil` / `waiting for` | "รอนานเกินไป — อาจเป็นเพราะหน้ายังโหลดไม่เสร็จ หรืออยู่ผิดหน้า คุณเห็นหน้าจอตอนนี้เป็นยังไง?" |
   | `stale element reference` / `StaleElementReferenceError` | "Element หายไประหว่าง interact — หน้าอาจ reload หรือ DOM เปลี่ยน คุณเห็นหน้ากระพริบหรือโหลดใหม่ไหม?" |
   | `AssertionError` / `expected` / `assert` | "ค่าที่ได้ไม่ตรงที่คาดไว้ — อาจเป็นเพราะข้อมูลผิดหรือดูผิด element คุณอยากให้ผมดูค่าจริง หรือ pick element ที่ถูกต้อง?" |
   | `navigation` / `ERR_` / `net::` | "หน้าไม่ตรง — อาจ redirect ผิดหรือต้อง login ก่อน คุณเห็นหน้าอะไรอยู่ตอนนี้?" |
   | `frame` / `iframe` / `switchToFrame` / `contentFrame` | "Element อาจอยู่ใน iframe — คุณเห็น element ที่ต้องการอยู่ในกรอบเล็กๆ บนหน้าจอไหม?" |
   | `ECONNREFUSED` / `session not created` / `session deleted` | "Browser อาจปิดหรือ crash ไป — คุณยังเห็นหน้าต่าง browser อยู่ไหม?" |
   | Unrecognized error | "เกิด error ที่ไม่คาดคิด — คุณเห็นอะไรบนหน้าจอตอนนี้? หรืออยากให้ผมวิเคราะห์เอง?" |

4. **Interpret QA's response and act:**

   QA can type anything. Interpret their intent:

   - **"วิเคราะห์ให้" / "ดูให้" / "เช็คให้" / asks agent to investigate:**
     Use playwright-cli to inspect the live app (see Investigation Toolkit below).
     Report findings in plain language. Then propose a fix — do NOT apply yet.

   - **"pick เอง" / "pick element" / "ชี้เอง" / wants to pick an element:**
     Enter `/identify-element` flow. QA clicks the element. Agent builds selector
     from the returned attributes. Propose fix — do NOT apply yet.

   - **"ข้าม" / "skip" / "ไม่ต้องแก้" / wants to skip:**
     Signal continue, move to next test.

   - **"selector ผิด" / "ไม่ใช่ตัวนี้" / says the element is wrong:**
     Suggest: "คุณอยาก pick element ที่ถูกต้องไหม?" If yes → `/identify-element`.

   - **"wait ไม่ทัน" / "โหลดช้า" / says it's a timing issue:**
     Agent investigates timing → proposes adding explicit wait in code.

   - **QA's response is unclear:**
     Rephrase the question simpler (see Rephrase Rules below).

   - **Agent investigated but cause is inconclusive:**
     Tell QA what you checked and offer: "ผมดูแล้วยังไม่ชัดเจน — คุณอยาก pick element ที่ถูกต้อง, บอกข้อมูลเพิ่ม, หรือข้ามไปก่อน?"

5. **Fix-after-confirm:**

   Agent MUST NOT apply any fix until QA confirms:
   1. Agent shows finding: "ผมเจอว่า [root cause]"
   2. Agent proposes fix: "จะแก้ [what] เป็น [what] ได้ไหม?" (show old vs new)
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
Escalate through simpler language:

**Attempt 1 — Rephrase shorter:**
Instead of "อาจเป็นเพราะ wait ไม่ทัน หรือ selector ผิดจริงๆ"
say "คุณเห็นปุ่มนี้บนหน้าจอไหม? ใช่ หรือ ไม่"

**Attempt 2 — Yes/no question:**
"คุณเห็น [element description] อยู่บนหน้าจอตอนนี้ไหม?"

**Attempt 3 — Default to investigation:**
"ผมจะลองดูเองนะครับ" → investigate using the toolkit above, then report findings.

After investigating, always come back with a **concrete finding and proposed fix**.
Never leave QA hanging with "I don't know."

## Important rules

- **NEVER guess selectors from training data** — you MUST inspect the live DOM via CDP to discover the correct selector. Do not suggest a fix based on what you "think" the selector should be. Always run a snapshot or eval first, read the real attributes, then propose the fix based on what you actually see.
- **NEVER assume a failure is a bug** — always ask QA first
- **NEVER modify test config files** — only touch test files and page objects
- **ALWAYS use the project's wrapper API** — learn it from existing code, don't use raw browser/page calls
- **Use targeted snapshots** (`--depth=3` or element-specific) to save tokens
- **Use --raw flag** on playwright-cli eval to get clean output
- **Redirect mocha stdout to file** — read only relevant lines, don't dump entire output into context
- **Use HTTP IPC** via `walkthrough-hooker.js` + `WALKTHROUGH_PORT` env var. Requires Mocha ^10.2.0.
- **NEVER fix without QA confirmation** — investigate and propose, but always ask "ได้ไหม?" before applying changes
- **ALWAYS match error to pattern first** — read the error message and use the Error Pattern table to ask the right question
- **ALWAYS report findings in plain language** — QA should never see playwright-cli commands, raw JSON, or technical jargon
- **ALWAYS offer pick element** when the issue might be a wrong selector — say "คุณอยาก pick element ที่ถูกต้องไหม?"
- **Use the rephrase escalation** when QA doesn't understand — simpler → yes/no → investigate yourself
