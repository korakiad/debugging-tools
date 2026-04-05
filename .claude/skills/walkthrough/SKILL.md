---
name: walkthrough
description: Use when QA wants to debug failing E2E tests interactively — runs real test suite, pauses on each failure, inspects live app via CDP, asks QA to triage, and fixes selector or code issues in place
allowed-tools: Bash(mocha:*) Bash(npx:*) Bash(node:*) Bash(playwright-cli:*) Bash(cp:*) Bash(rm:*) Bash(touch:*) Bash(cat:*) Bash(mkdir:*)
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

## Session flow

### Phase 1: Auto-detect project

Read the codebase to learn the framework. Do NOT ask QA to configure anything.

1. Read `package.json` → confirm mocha + wdio dependencies
2. Read 3-5 test files → identify wrapper pattern (e.g. `Ws.instance.client.$()`)
3. Trace imports from test files → find page object directory
4. Scan page objects → learn selector strategy (css, aria, data-testid)
5. Find CDP port from test config or framework setup files

Store these findings — you'll need them for every fix you suggest.

### Phase 2: Inject hook and run tests

1. Copy the hook file to the project root:
```bash
cp .claude/skills/walkthrough/walkthrough-hooks.js .walkthrough-hooks.js
```

2. Run mocha in background with the hook:
```bash
mocha <spec-file> --require .walkthrough-hooks.js [any other flags QA normally uses] > .walkthrough/mocha-output.log 2>&1 &
```

3. Attach to the running app via CDP:
```bash
playwright-cli attach --cdp=http://localhost:<port>
```

4. Start screencast for evidence:
```bash
playwright-cli video-start walkthrough-session.webm
```

### Phase 3: Debug loop

Monitor `.walkthrough/status.json` for state changes.

When `.walkthrough/paused.json` appears (test failed):

1. **Read the failure** from `paused.json` — get test name, file, error message, stack
2. **Inspect the live app** via playwright-cli:
   ```bash
   playwright-cli snapshot --depth=4
   ```
   For specific elements:
   ```bash
   playwright-cli --raw eval "el => JSON.stringify({tag: el.tagName, id: el.id, class: el.className, 'data-testid': el.getAttribute('data-testid'), 'aria-label': el.getAttribute('aria-label')})" "<selector>"
   ```
3. **Show failure to QA** in plain language:
   - What test failed
   - What the error means
   - What you see in the live app
4. **Ask QA: "Is this a real bug or an environment/timing issue?"**
5. Based on QA's answer:

   **If environment/timing issue:**
   - Say "Skipping — marking as environment issue"
   - Signal continue

   **If real bug — selector issue:**
   - Read the test file and find the failing selector
   - Find which page object owns it
   - Inspect the live DOM to find the correct selector
   - Show QA the fix (old vs new) with file and line number
   - Ask which selector strategy to use if multiple options
   - Apply the fix
   - Signal continue

   **If real bug — code pattern issue (try/catch, async/await, assertion):**
   - Read the test code around the failure
   - Identify the structural problem
   - Show QA the fix
   - Apply the fix
   - Signal continue

   **If you can't determine the cause:**
   - Ask QA specific questions:
     "What should happen when you click this element?"
     "Is this element supposed to be visible at this point?"
   - Use their answers to guide investigation

6. **Signal continue:**
   ```bash
   touch .walkthrough/continue
   ```

7. **Repeat** until `.walkthrough/status.json` shows `"state": "done"`

### Phase 4: Cleanup

1. Stop screencast:
   ```bash
   playwright-cli video-stop
   ```
2. Remove injected files:
   ```bash
   rm -f .walkthrough-hooks.js
   rm -rf .walkthrough/
   ```
3. Print session summary:
   - How many tests passed / failed
   - What you fixed (file, line, old → new)
   - What was skipped (environment issues)
   - Where the screencast is saved

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

## Important rules

- **NEVER guess selectors from training data** — you MUST inspect the live DOM via CDP to discover the correct selector. Do not suggest a fix based on what you "think" the selector should be. Always run a snapshot or eval first, read the real attributes, then propose the fix based on what you actually see.
- **NEVER assume a failure is a bug** — always ask QA first
- **NEVER modify test config files** — only touch test files and page objects
- **ALWAYS clean up** — remove .walkthrough-hooks.js and .walkthrough/ when done
- **ALWAYS use the project's wrapper API** — learn it from existing code, don't use raw browser/page calls
- **Use targeted snapshots** (`--depth=3` or element-specific) to save tokens
- **Use --raw flag** on playwright-cli eval to get clean output
- **Redirect mocha stdout to file** — read only relevant lines, don't dump entire output into context
