# /identify-element Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Claude Code skill that lets QA visually pick an element in the browser and returns structured DOM attributes + frame chain, so the agent can build the correct selector for any framework.

**Architecture:** A Playwright code snippet (`pick-element.js`) run via `playwright-cli run-code --filename=...`. Uses `page.pickLocator()` for visual picking (handles nested iframes natively), then extracts raw DOM attributes via `locator.evaluate()` and parses the frame chain from the internal selector string. A `SKILL.md` instructs the agent how to invoke the script and confirm the result with QA.

**Tech Stack:** Playwright (via globally installed `@playwright/cli`), `playwright-cli run-code`, `page.pickLocator()`, `locator.evaluate()`

**Relevant context:**
- Design doc: `docs/plans/2026-04-05-identify-element-design.md`
- Existing walkthrough skill: `.claude/skills/walkthrough/SKILL.md`
- playwright-cli installed globally: `@playwright/cli@0.1.5` with `playwright@1.60.0-alpha`
- `playwright-cli --raw run-code` returns clean JSON output
- `locator._selector` exposes the raw selector string including frame path
- `locator.toString()` returns readable form like `locator('#user-name')`

---

### Task 1: Create pick-element.js (Playwright code snippet)

**Files:**
- Create: `.claude/skills/identify-element/references/pick-element.js`

**Step 1: Create the directory**

```bash
mkdir -p .claude/skills/identify-element/references
```

**Step 2: Write the code snippet**

This is a function that `playwright-cli run-code --filename=` will invoke with `page` as argument. It must be a bare async function expression — no module.exports, no imports.

```javascript
async (page) => {
    // 1. Enter pick mode — blocks until QA clicks an element
    const locator = await page.pickLocator();

    // 2. Get raw selector (includes frame path with >> internal:control=enter-frame >>)
    const rawSelector = locator._selector || '';

    // 3. Extract element attributes
    const element = await locator.evaluate(el => {
        const data = {};
        const aria = {};
        for (const attr of el.attributes) {
            if (attr.name.startsWith('data-'))
                data[attr.name.slice(5)] = attr.value;
            else if (attr.name.startsWith('aria-'))
                aria[attr.name.slice(5)] = attr.value;
        }
        return {
            tag: el.tagName.toLowerCase(),
            id: el.id || '',
            name: el.getAttribute('name') || '',
            type: el.getAttribute('type') || '',
            classes: [...el.classList],
            placeholder: el.getAttribute('placeholder') || '',
            data,
            aria: { ...aria, role: el.getAttribute('role') || '' },
            text: el.textContent?.trim().substring(0, 200) || ''
        };
    });

    // 4. Parse frame chain from raw selector
    const FRAME_SEP = ' >> internal:control=enter-frame >> ';
    const parts = rawSelector.split(FRAME_SEP);
    const frameSelectors = parts.slice(0, -1);

    // 5. Extract iframe attributes for each frame in chain
    const frames = [];
    let context = page;
    for (const fs of frameSelectors) {
        try {
            const attrs = await context.locator(fs).evaluate(el => ({
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                name: el.getAttribute('name') || '',
                src: el.getAttribute('src') || '',
                classes: [...el.classList]
            }));
            frames.push(attrs);
            context = context.frameLocator(fs);
        } catch {
            frames.push({ selector: fs });
        }
    }

    return { element, frames, playwrightLocator: locator.toString() };
}
```

**Step 3: Verify syntax**

Run: `node -c .claude/skills/identify-element/references/pick-element.js`
Expected: no output (syntax OK)

**Step 4: Verify file loads via run-code**

Run: `playwright-cli --raw run-code "async (page) => { return 'pick-element load test'; }"`
Expected: `"pick-element load test"`

This confirms `run-code` works with the current playwright-cli session.

**Step 5: Commit**

```bash
git add .claude/skills/identify-element/references/pick-element.js
git commit -m "feat: add pick-element.js for visual element identification"
```

---

### Task 2: Create SKILL.md (agent instructions)

**Files:**
- Create: `.claude/skills/identify-element/SKILL.md`

**Step 1: Write the skill document**

```markdown
---
name: identify-element
description: Use when the agent needs QA to visually identify a specific element in the browser — enters pick mode, QA clicks the element, returns structured DOM attributes and frame chain so the agent can build the correct selector for any framework
allowed-tools: Bash(playwright-cli:*)
---

# /identify-element — Visual Element Identification

## Quick start

```bash
# QA invokes when agent needs to know which element they mean
/identify-element
```

## Prerequisites

A browser must already be attached via playwright-cli:
```bash
playwright-cli attach --cdp=http://localhost:<port>
```

## How to use

### Step 1: Tell QA what's about to happen

Say: "I'm entering pick mode. Please click the element you want to identify in the browser. You'll see elements highlight as you hover."

### Step 2: Run the picker

```bash
playwright-cli --raw run-code --filename=.claude/skills/identify-element/references/pick-element.js
```

This blocks until QA clicks an element. The browser shows hover highlights on all elements (including inside iframes).

### Step 3: Read the result

The command returns JSON:
```json
{
  "element": {
    "tag": "input",
    "id": "user-name",
    "name": "user-name",
    "type": "text",
    "classes": ["input_error", "form_input"],
    "placeholder": "Username",
    "data": { "test": "login-credentials" },
    "aria": { "label": "Username", "role": "textbox" },
    "text": ""
  },
  "frames": [],
  "playwrightLocator": "locator('#user-name')"
}
```

- **element** — raw DOM attributes to build a selector from
- **frames** — iframe chain from outermost to innermost (empty = top frame)
- **playwrightLocator** — Playwright's suggestion, for reference only

### Step 4: Confirm with QA

Show QA what was picked in plain language:

"You picked a `<input>` element with:
- id: `user-name`
- data-test: `login-credentials`
- placeholder: `Username`

Is this the correct element?"

### Step 5: Handle response

**If QA confirms:** Read the project's test files to learn selector strategy, then build the correct selector using the attributes from the JSON.

**If QA says no:** Go back to Step 1 and re-pick.

## Frame handling

If the element is inside nested iframes, the `frames` array contains each iframe's attributes:

```json
{
  "frames": [
    { "tag": "iframe", "id": "app-frame", "name": "main", "src": "/app", "classes": [] },
    { "tag": "iframe", "id": "", "name": "login", "src": "/login", "classes": ["nested"] }
  ]
}
```

The agent should read the project's existing code to determine the frame handling pattern:
- If the project uses `switchToFrame()` → build a frame switch sequence
- If the project uses chained `$('iframe').$('element')` → build chained selectors
- Match whatever pattern the project already uses

## Important rules

- **ALWAYS confirm with QA** before using the result
- **NEVER guess** which element QA means — always use the picker
- **NEVER build selectors from training data** — use only the attributes from the JSON output
- **Match the project's selector strategy** — read existing test code to learn what pattern to use
```

**Step 2: Verify frontmatter**

- name: `identify-element` — valid
- description: starts with "Use when" — valid
- allowed-tools: only `Bash(playwright-cli:*)` — minimal

**Step 3: Commit**

```bash
git add .claude/skills/identify-element/SKILL.md
git commit -m "feat: add /identify-element skill for visual element picking"
```

---

### Task 3: Manual verification with saucedemo.com

This test requires human interaction (QA clicks an element). Run manually.

**Step 1: Ensure browser is attached**

The WDIO test from earlier left a session on saucedemo.com. If not, open one:
```bash
playwright-cli open https://www.saucedemo.com
```

Or attach to an existing Chrome with CDP:
```bash
playwright-cli attach --cdp=http://localhost:9222
```

**Step 2: Run the picker**

```bash
playwright-cli --raw run-code --filename=.claude/skills/identify-element/references/pick-element.js
```

**Step 3: Click the username input field**

Expected output (approximately):
```json
{
  "element": {
    "tag": "input",
    "id": "user-name",
    "name": "user-name",
    "type": "text",
    "classes": ["input_error", "form_input"],
    "placeholder": "Username",
    "data": { "test": "username" },
    "aria": {},
    "text": ""
  },
  "frames": [],
  "playwrightLocator": "locator('#user-name')"
}
```

**Step 4: Verify with login button**

Run picker again, click the Login button. Expected:
- `tag`: `input`
- `id`: `login-button`
- `data`: `{ "test": "login-button" }`

**Step 5: Commit verification notes (if any fixes were needed)**

---

### Task 4: Update walkthrough skill to reference identify-element

**Files:**
- Modify: `.claude/skills/walkthrough/SKILL.md`

**Step 1: Add identify-element to the selector fix strategy**

In the "Debug loop" section (Phase 3, step 5, "If real bug — selector issue"), add a reference to `/identify-element`:

Replace the current selector fix flow with:

```markdown
   **If real bug — selector issue:**
   - Ask QA to visually pick the correct element using `/identify-element`
   - Read the structured DOM output (element attributes + frame chain)
   - Find which page object owns the failing selector
   - Match the project's selector strategy to the picked element's attributes
   - Show QA the fix (old vs new) with file and line number
   - Apply the fix
   - Signal continue
```

**Step 2: Commit**

```bash
git add .claude/skills/walkthrough/SKILL.md
git commit -m "feat: integrate /identify-element into walkthrough selector fix flow"
```

---

## Execution Order

1. **Task 1** — Create pick-element.js
2. **Task 2** — Create SKILL.md
3. **Task 3** — Manual verification (requires human interaction)
4. **Task 4** — Update walkthrough skill

## Dependencies

```
Task 1 (pick-element.js) → Task 2 (SKILL.md) → Task 3 (verification)
                                               → Task 4 (walkthrough integration)
```

## Notes for implementer

- **`run-code --filename`**: The file must contain a bare async function expression — no `module.exports`, no `require`. Just `async (page) => { ... }`.
- **`--raw` flag**: Always use `--raw` to get clean JSON output without markdown formatting.
- **`locator._selector`**: This is a private property. It works in current Playwright 1.60.0-alpha but could change in future versions. If it breaks, fall back to parsing `locator.toString()`.
- **Frame context traversal**: `context.frameLocator(fs)` returns a FrameLocator. Its `.locator()` method searches inside that frame. This is how we evaluate iframe attributes at each nesting level.
- **Timeout**: `pickLocator()` blocks indefinitely. The agent should warn QA before running and have a plan if QA doesn't click (e.g., Ctrl+C and ask QA to describe the element).
