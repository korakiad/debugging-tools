# /walkthrough Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Claude Code skill that lets QA run `/walkthrough spec/file.js` to collaboratively debug failing E2E tests with an AI agent that pauses on failures, inspects the real app via CDP, and asks QA before fixing.

**Architecture:** Two files — a Mocha root hook plugin (walkthrough-hooks.js) that pauses test execution on failure via file-based signaling, and a SKILL.md that instructs the agent how to orchestrate the debug session (auto-detect framework, inject hook, attach CDP, inspect, ask QA, fix, cleanup).

**Tech Stack:** Mocha root hooks (`exports.mochaHooks`), playwright-cli (CDP attach, snapshots, screencast), WDIO (as library via wrapper), Node.js fs for IPC signaling.

**Relevant context:**
- Design doc: `docs/plans/2026-04-05-walkthrough-debug-agent-design.md`
- Existing playwright-cli skill: `.claude/skills/playwright-cli/SKILL.md`
- User's framework: Mocha standalone + WDIO as library, wrapper `Ws.instance.client.$()`, custom config loading via `testconfig.json`
- All apps expose `--remote-debugging-port` for CDP

---

### Task 1: Create walkthrough-hooks.js (Mocha root hook plugin)

**Files:**
- Create: `.claude/skills/walkthrough/walkthrough-hooks.js`

**Step 1: Create the hook file**

```javascript
// Mocha Root Hook Plugin for /walkthrough debug sessions
// Injected via: mocha <spec> --require <path-to-this-file>
// Pauses test execution on failure, waits for agent to signal continue.

const fs = require('fs');
const path = require('path');

const SIGNAL_DIR = path.join(process.cwd(), '.walkthrough');
const PAUSED_FILE = path.join(SIGNAL_DIR, 'paused.json');
const CONTINUE_FILE = path.join(SIGNAL_DIR, 'continue');
const POLL_INTERVAL_MS = 500;

exports.mochaHooks = {
    beforeAll() {
        // Clean up stale signals from previous runs
        if (fs.existsSync(SIGNAL_DIR)) {
            try { fs.rmSync(SIGNAL_DIR, { recursive: true }); } catch {}
        }
        fs.mkdirSync(SIGNAL_DIR, { recursive: true });

        // Write a "started" signal so agent knows tests are running
        fs.writeFileSync(
            path.join(SIGNAL_DIR, 'status.json'),
            JSON.stringify({ state: 'running', startedAt: Date.now() })
        );
    },

    afterEach: async function () {
        if (this.currentTest.state === 'failed') {
            // Write failure details for agent to read
            fs.writeFileSync(PAUSED_FILE, JSON.stringify({
                test: this.currentTest.title,
                suite: this.currentTest.parent?.title,
                file: this.currentTest.file,
                error: this.currentTest.err?.message,
                stack: this.currentTest.err?.stack,
                duration: this.currentTest.duration,
                pausedAt: Date.now()
            }, null, 2));

            // Update status
            fs.writeFileSync(
                path.join(SIGNAL_DIR, 'status.json'),
                JSON.stringify({ state: 'paused', pausedAt: Date.now() })
            );

            // Block until agent writes the continue signal
            await new Promise(resolve => {
                const check = setInterval(() => {
                    if (fs.existsSync(CONTINUE_FILE)) {
                        try { fs.unlinkSync(CONTINUE_FILE); } catch {}
                        try { fs.unlinkSync(PAUSED_FILE); } catch {}
                        clearInterval(check);
                        resolve();
                    }
                }, POLL_INTERVAL_MS);
            });

            // Update status back to running
            fs.writeFileSync(
                path.join(SIGNAL_DIR, 'status.json'),
                JSON.stringify({ state: 'running', resumedAt: Date.now() })
            );
        }
    },

    afterAll() {
        // Write completion signal
        fs.writeFileSync(
            path.join(SIGNAL_DIR, 'status.json'),
            JSON.stringify({ state: 'done', finishedAt: Date.now() })
        );
    }
};
```

**Step 2: Verify syntax is valid**

Run: `node -c .claude/skills/walkthrough/walkthrough-hooks.js`
Expected: no output (syntax OK)

**Step 3: Commit**

```bash
git add .claude/skills/walkthrough/walkthrough-hooks.js
git commit -m "feat: add walkthrough mocha root hook plugin"
```

---

### Task 2: Create test fixture to verify hook behavior

**Files:**
- Create: `test/walkthrough-hook-test/sample-failing.spec.js`
- Create: `test/walkthrough-hook-test/verify-hook.sh`

**Step 1: Create a minimal failing mocha test**

```javascript
// test/walkthrough-hook-test/sample-failing.spec.js
// Minimal test fixture to verify the walkthrough hook pauses on failure.

describe('Walkthrough Hook Verification', function () {
    it('should pass', function () {
        // This test passes — hook should NOT pause here
    });

    it('should fail and trigger pause', function () {
        throw new Error('Deliberate failure to test walkthrough hook');
    });

    it('should also pass', function () {
        // This test should only run AFTER agent signals continue
    });
});
```

**Step 2: Create a verification script**

This script runs the failing test with the hook, then simulates the agent
signaling continue after verifying the pause file was created.

```bash
#!/usr/bin/env bash
# test/walkthrough-hook-test/verify-hook.sh
# Verifies the walkthrough hook pauses on failure and resumes on continue signal.

set -e

HOOK_PATH="$(cd "$(dirname "$0")/../../.claude/skills/walkthrough" && pwd)/walkthrough-hooks.js"
SPEC_PATH="$(dirname "$0")/sample-failing.spec.js"
SIGNAL_DIR="$(pwd)/.walkthrough"

echo "=== Walkthrough Hook Verification ==="
echo "Hook: $HOOK_PATH"
echo "Spec: $SPEC_PATH"

# Clean up from previous runs
rm -rf "$SIGNAL_DIR"

# Run mocha in background with the hook
npx mocha "$SPEC_PATH" --require "$HOOK_PATH" --timeout 30000 &
MOCHA_PID=$!

echo "Mocha running (PID: $MOCHA_PID)"

# Wait for pause signal (poll every 1s, timeout after 15s)
WAITED=0
while [ ! -f "$SIGNAL_DIR/paused.json" ] && [ $WAITED -lt 15 ]; do
    sleep 1
    WAITED=$((WAITED + 1))
done

if [ ! -f "$SIGNAL_DIR/paused.json" ]; then
    echo "FAIL: paused.json was not created within 15s"
    kill $MOCHA_PID 2>/dev/null
    exit 1
fi

echo "PASS: paused.json created"
cat "$SIGNAL_DIR/paused.json"

# Verify status is paused
if grep -q '"state":"paused"' "$SIGNAL_DIR/status.json" 2>/dev/null || \
   grep -q '"state": "paused"' "$SIGNAL_DIR/status.json" 2>/dev/null; then
    echo "PASS: status.json shows paused"
else
    echo "FAIL: status.json does not show paused state"
    kill $MOCHA_PID 2>/dev/null
    exit 1
fi

# Signal continue
touch "$SIGNAL_DIR/continue"
echo "Signaled continue"

# Wait for mocha to finish
wait $MOCHA_PID
EXIT_CODE=$?

# Mocha exits non-zero because one test failed — that's expected
if [ -f "$SIGNAL_DIR/status.json" ]; then
    if grep -q '"done"' "$SIGNAL_DIR/status.json"; then
        echo "PASS: status.json shows done"
    fi
fi

echo ""
echo "=== All hook verifications passed ==="

# Cleanup
rm -rf "$SIGNAL_DIR"
```

**Step 3: Run the verification**

Run: `bash test/walkthrough-hook-test/verify-hook.sh`
Expected:
```
=== Walkthrough Hook Verification ===
PASS: paused.json created
PASS: status.json shows paused
Signaled continue
PASS: status.json shows done
=== All hook verifications passed ===
```

**Step 4: Commit**

```bash
git add test/walkthrough-hook-test/
git commit -m "test: add walkthrough hook verification fixture"
```

---

### Task 3: Create SKILL.md (agent orchestration instructions)

**Files:**
- Create: `.claude/skills/walkthrough/SKILL.md`

**Step 1: Write the skill document**

The SKILL.md instructs the agent on how to orchestrate the entire walkthrough session. It covers: auto-detection, hook injection, mocha execution, CDP attachment, the debug loop, fix strategies, and cleanup.

```markdown
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

- **NEVER assume a failure is a bug** — always ask QA first
- **NEVER modify test config files** — only touch test files and page objects
- **ALWAYS clean up** — remove .walkthrough-hooks.js and .walkthrough/ when done
- **ALWAYS use the project's wrapper API** — learn it from existing code, don't use raw browser/page calls
- **Use targeted snapshots** (`--depth=3` or element-specific) to save tokens
- **Use --raw flag** on playwright-cli eval to get clean output
- **Redirect mocha stdout to file** — read only relevant lines, don't dump entire output into context
```

**Step 2: Verify frontmatter is valid**

Check that name uses only letters/numbers/hyphens and description starts with "Use when":
- name: `walkthrough` — valid
- description: starts with "Use when QA wants to debug" — valid

**Step 3: Commit**

```bash
git add .claude/skills/walkthrough/SKILL.md
git commit -m "feat: add /walkthrough skill for collaborative E2E debugging"
```

---

### Task 4: Add .gitignore entry for walkthrough signals

**Files:**
- Modify: `.gitignore` (create if doesn't exist)

**Step 1: Create or update .gitignore**

```
# Walkthrough debug session signals (temporary, auto-cleaned)
.walkthrough/
.walkthrough-hooks.js
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add walkthrough temp files to gitignore"
```

---

### Task 5: End-to-end skill test with a simulated debug session

**Files:**
- Create: `test/walkthrough-e2e/failing-selector.spec.js`
- Create: `test/walkthrough-e2e/mock-page-object.js`

This tests the full loop: hook pauses, agent reads failure, inspects element,
applies fix. Uses a simple local HTML page (no real app needed).

**Step 1: Create a mock page object**

```javascript
// test/walkthrough-e2e/mock-page-object.js
// Simulates the Ws.instance.client pattern with a deliberately wrong selector.

class MockPage {
    // This selector is deliberately wrong — the real element uses data-testid
    get submitButton() {
        return 'button.old-submit-class';
    }

    // This is what the fix should look like
    // get submitButton() {
    //     return 'button[data-testid="submit-btn"]';
    // }
}

module.exports = { MockPage };
```

**Step 2: Create a failing test that uses the mock page object**

```javascript
// test/walkthrough-e2e/failing-selector.spec.js
// E2E test using a mock page object with a stale selector.

const { MockPage } = require('./mock-page-object');

describe('Login Form', function () {
    const page = new MockPage();

    it('should click the submit button', async function () {
        // In a real test this would be:
        // await Ws.instance.client.$(page.submitButton).click()
        // Simulating failure: selector doesn't match
        const selector = page.submitButton;
        if (selector === 'button.old-submit-class') {
            throw new Error(
                `Element not found: $(\'${selector}\') - ` +
                'no matching element in the DOM'
            );
        }
    });

    it('should verify login success', function () {
        // This should pass
    });
});
```

**Step 3: Run with walkthrough hook to verify the pause/continue cycle works end-to-end**

Run: `bash test/walkthrough-hook-test/verify-hook.sh` (reusing from Task 2, pointing at new spec)

Or manually:
```bash
npx mocha test/walkthrough-e2e/failing-selector.spec.js \
  --require .claude/skills/walkthrough/walkthrough-hooks.js \
  --timeout 30000 &

# Wait for pause
sleep 3
cat .walkthrough/paused.json
# Should show: "Element not found: $('button.old-submit-class')"

# Signal continue
touch .walkthrough/continue

# Wait for completion
sleep 2
cat .walkthrough/status.json
# Should show: "state": "done"
```

**Step 4: Commit**

```bash
git add test/walkthrough-e2e/
git commit -m "test: add e2e test fixture for walkthrough skill"
```

---

### Task 6: Initialize git repo and make initial commit

> **Note:** This task should be done FIRST if the repo hasn't been initialized yet.
> The project currently has no git repo (`Is a git repository: false`).

**Step 1: Initialize git**

```bash
cd G:/claude-project/debuggig-tools
git init
```

**Step 2: Create .gitignore**

```
node_modules/
.walkthrough/
.walkthrough-hooks.js
```

**Step 3: Initial commit with existing files**

```bash
git add .gitignore .claude/skills/playwright-cli/ docs/plans/
git commit -m "chore: initial commit with playwright-cli skill and walkthrough design docs"
```

---

## Execution Order

Since the repo is not yet initialized, execute in this order:

1. **Task 6** — Initialize git repo
2. **Task 1** — Create walkthrough-hooks.js
3. **Task 2** — Create hook verification test
4. **Task 3** — Create SKILL.md
5. **Task 4** — Update .gitignore (merge with Task 6's .gitignore)
6. **Task 5** — E2E test fixture

## Dependencies

```
Task 6 (git init) → Task 1 (hook) → Task 2 (hook test)
                                   → Task 3 (SKILL.md)
                  → Task 4 (.gitignore)
Task 1 + Task 3 → Task 5 (e2e test)
```

## Notes for implementer

- **Mocha version**: Hook requires Mocha 8+ for root hook plugins. Check `package.json` — if mocha < 8, use `--file` instead of `--require` with a different hook format.
- **playwright-cli**: Must be v0.1.5+ for `attach --cdp` support. Verify with `playwright-cli --version`.
- **CDP port**: The design assumes port 9222 but the agent should auto-detect from the project's config. Use 9222 as default fallback.
- **Windows paths**: The hook uses `path.join` which handles OS differences. The SKILL.md bash commands should work in the Git Bash environment the project uses.
