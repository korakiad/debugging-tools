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
