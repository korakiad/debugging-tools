# /walkthrough — Collaborative E2E Debug Agent

**Date:** 2026-04-05
**Status:** Approved

## Problem

QA engineers maintain large E2E test suites (Mocha + WDIO) across web, Electron, and OpenFin apps. When tests fail, QA struggles to understand why — selectors go stale, try/catch patterns break, app UI changes. They don't want to learn framework internals, configure tools, or parse error logs.

## Solution

A Claude Code skill (`/walkthrough`) that:
1. Runs the existing test suite with a single injected Mocha hook
2. Pauses on each failure with the real app frozen in failure state
3. Inspects the live DOM via CDP attachment to the actual running app
4. Asks QA whether each failure is a real bug or environment issue
5. Diagnoses and fixes real bugs (selector updates, code pattern fixes)
6. Continues through remaining tests

## Key Design Decisions

### Zero-config
Agent auto-detects framework, wrapper API (`Ws.instance.client.$`), POM patterns, and selector strategy by reading the codebase. No JSON profiles or setup steps for QA.

### Real test runner, not mimicking
Tests run with the actual Mocha + WDIO stack, preserving all hooks, fixtures, config loading, and runtime behavior. The agent does NOT replay tests via playwright-cli — it attaches to the real execution.

### CDP attachment to real app
All apps (web/Electron/OpenFin) expose `--remote-debugging-port`. The agent connects via:
```bash
playwright-cli attach --cdp=http://localhost:9222
```
This gives the agent access to the real DOM in the real runtime — no environment mismatch.

### Minimal injection — one hook file
The only file injected is `.walkthrough-hooks.js`, a Mocha root hook plugin (~25 lines). It pauses execution on failure and waits for the agent to signal continue. Does not touch:
- Config loading (testconfig.json)
- Framework packages
- Browser setup / Ws.instance.client
- Existing hooks or test structure

### Human-in-the-loop
The agent never assumes a failure is a bug. It shows the failure to QA and asks. QA decides — the agent investigates and fixes.

## Architecture

```
QA invokes: /walkthrough spec/login.spec.js

┌──────────────────────────────────────────────────────┐
│ Agent                                                 │
│                                                       │
│ 1. Auto-detect: reads codebase (package.json, tests,  │
│    POMs, wdio config) — learns framework/wrapper/     │
│    selector strategy                                   │
│                                                       │
│ 2. Creates .walkthrough-hooks.js (from skill template) │
│                                                       │
│ 3. Runs existing mocha command in background:          │
│    mocha spec/login.spec.js --require                  │
│      .walkthrough-hooks.js                             │
│                                                       │
│ 4. Attaches to real app:                               │
│    playwright-cli attach --cdp=http://localhost:9222    │
│    playwright-cli video-start walkthrough.webm         │
│                                                       │
│ 5. Debug loop (per failure):                           │
│    ┌─────────────────────────────────────┐             │
│    │ Hook writes .walkthrough/paused.json │             │
│    │ Agent reads failure details          │             │
│    │ Agent inspects real DOM via CDP      │             │
│    │ Agent asks QA: "real bug?"           │             │
│    │                                     │             │
│    │ QA: "environment" → skip            │             │
│    │ QA: "real bug" →                    │             │
│    │   Selector issue → inspect DOM,     │             │
│    │     compare, fix POM                │             │
│    │   Code issue → read test, fix       │             │
│    │   Unknown → ask QA custom questions │             │
│    │                                     │             │
│    │ Agent writes .walkthrough/continue   │             │
│    │ Hook unblocks → next test           │             │
│    └─────────────────────────────────────┘             │
│                                                       │
│ 6. Cleanup:                                            │
│    - Delete .walkthrough-hooks.js                      │
│    - Delete .walkthrough/ directory                    │
│    - Stop screencast                                   │
│    - Print session summary                             │
└──────────────────────────────────────────────────────┘
```

## The Hook File

```javascript
// .walkthrough-hooks.js
const fs = require('fs');
const path = require('path');
const signalDir = path.join(process.cwd(), '.walkthrough');

exports.mochaHooks = {
    afterEach: async function () {
        if (this.currentTest.state === 'failed') {
            fs.mkdirSync(signalDir, { recursive: true });
            fs.writeFileSync(
                path.join(signalDir, 'paused.json'),
                JSON.stringify({
                    test: this.currentTest.title,
                    suite: this.currentTest.parent?.title,
                    file: this.currentTest.file,
                    error: this.currentTest.err?.message,
                    stack: this.currentTest.err?.stack
                })
            );
            await new Promise(resolve => {
                const check = setInterval(() => {
                    if (fs.existsSync(path.join(signalDir, 'continue'))) {
                        try { fs.unlinkSync(path.join(signalDir, 'continue')); } catch {}
                        clearInterval(check);
                        resolve();
                    }
                }, 500);
            });
        }
    }
};
```

## Communication Protocol

```
Test fails → hook writes .walkthrough/paused.json
           → hook blocks (polls for .walkthrough/continue)

Agent reads .walkthrough/paused.json
      → attaches/inspects via CDP
      → asks QA
      → fixes or skips
      → writes .walkthrough/continue
      → hook unblocks → runner continues to next test
```

## Skill Structure

```
skills/
  walkthrough/
    SKILL.md                 # Agent orchestration instructions
    walkthrough-hooks.js     # Mocha root hook plugin (injected at runtime)
```

## Token Efficiency Strategies

- Run mocha with stdout redirected to file, agent reads only failure lines
- Use `playwright-cli snapshot --depth=3` or targeted element snapshots
- Use `--raw` flag to strip playwright-cli noise
- File-based signaling (paused.json) instead of parsing stdout
- Screencast saves to disk (zero token cost for visual context)

## UX Flow Example

```
QA:  /walkthrough spec/login.spec.js

Agent: "Scanning project... detected Mocha + WDIO, wrapper: Ws.instance.client"
       "Attaching to app on CDP port 9222..."
       "Running login.spec.js with walkthrough hook..."

       Test 1: "should login with valid credentials" PASSED
       Test 2: "should show error for invalid password" FAILED

       pause "The test expects $('div.error-toast') but I see the
          error is now in <span class='alert-error'>.
          Is this a real bug?"

QA:   "real bug"

Agent: "Fixing LoginPage.page.ts line 18:
         old: $('div.error-toast')
         new: $('[data-testid=\"login-error\"]')
        Applied. Continuing..."

       Test 3: "should handle timeout" FAILED

       pause "Timeout after 30s. Is this a real bug?"

QA:   "no, staging is slow"

Agent: "Skipping. All tests reviewed."
       "Summary: 1 passed, 1 fixed, 1 skipped (environment)"
       "Screencast: walkthrough.webm"
```

## Constraints

- Mocha must support `--require` with root hook plugins (Mocha 8+)
- App must expose `--remote-debugging-port` for CDP attach
- playwright-cli v0.1.5+ required (CDP attach support)
- Agent needs read/write access to test files and POM files for fixes

## Future Considerations

- Support for Playwright Test runner (different hook mechanism)
- Support for Cypress (different architecture entirely)
- Batch mode: run walkthrough unattended, collect all failures, review later
- Integration with CI: auto-create issues for confirmed bugs
