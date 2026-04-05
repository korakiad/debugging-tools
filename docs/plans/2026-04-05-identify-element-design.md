# /identify-element Skill Design

## Problem

When the walkthrough agent pauses on a failed selector, it needs to know which element QA intended. Currently the agent uses `playwright-cli snapshot` and guesses — but this fails on complex pages with many similar elements, and the no-guessing rule forbids using training data knowledge.

QA knows exactly which element they mean — they can see it on screen. We need a way for QA to **visually pick** the element and return structured DOM info the agent can use to build the correct selector for any framework.

## Solution

A Claude Code skill that uses Playwright's `page.pickLocator()` (via `playwright-cli run-code`) to let QA click an element in the browser. Instead of returning a Playwright locator string (useless for WDIO), it extracts raw DOM attributes and frame context — giving the agent everything it needs to build the correct selector matching the project's strategy.

## Architecture

```
QA clicks element in browser
         │
         ▼
┌──────────────────────────────────────────┐
│  playwright-cli run-code --filename=...  │
│  (pick-element.js)                       │
│  ├── page.pickLocator()                  │  ← Playwright handles frames, overlay
│  ├── locator.evaluate() → attributes     │  ← extract raw DOM info
│  ├── walk frame chain → iframe attrs     │  ← frame context for nested iframes
│  └── return JSON                         │  → agent reads structured output
└──────────────────────────────────────────┘
```

No custom CDP connection code. `playwright-cli attach --cdp=...` manages the session. The script is a code snippet run via `playwright-cli run-code --filename=`.

## Frame Handling

Playwright's `pickLocator()` handles nested iframes natively:
- Injects picker overlay into **all frames** via `safeNonStallingEvaluateInAllFrames()`
- When QA clicks in any frame, Playwright's binding automatically identifies which frame
- `generateFrameSelector()` walks the frame tree upward, generating selectors for each iframe element
- Results joined with `>> internal:control=enter-frame >>` internally

Our script extracts the frame chain as structured data (each iframe's tag, id, name, src) so the agent can adapt to the project's frame handling pattern (switchToFrame, chained selectors, etc.).

## Output Format

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
  "frames": [
    { "tag": "iframe", "id": "outer", "name": "main", "src": "/app" },
    { "tag": "iframe", "id": "", "name": "inner", "src": "/login" }
  ],
  "playwrightLocator": "getByRole('textbox', { name: 'Username' })"
}
```

- **element** — raw attributes for the agent to build a selector in any strategy
- **frames** — iframe chain from outermost to innermost (empty array = top frame). Agent uses this to determine frame switching approach based on project pattern
- **playwrightLocator** — Playwright's own suggestion, for reference only (not used directly)

## Agent Flow

1. Tell QA: "I'm entering pick mode. Please click the element you want to identify in the browser."
2. Run: `playwright-cli run-code --filename=.claude/skills/identify-element/references/pick-element.js`
3. Command blocks until QA clicks → returns JSON
4. Show QA the result: "You picked a `<input>` with id `user-name`. Is this the correct element?"
5. **If QA confirms** → read project code, match selector strategy, propose fix
6. **If QA says no** → re-pick (go to step 1)
7. **If timeout** → ask QA to describe the element instead

## Integration

- **`/walkthrough`** invokes `/identify-element` during the debug loop when QA confirms a failure is a real selector bug
- **Standalone** — can be used independently any time an agent needs to identify a specific element

## Scope Boundaries

**In scope:**
- Visual element picking via pickLocator()
- Structured DOM attribute extraction
- Frame chain extraction for nested iframes
- Confirm prompt with QA

**Out of scope (handle in /walkthrough or future skills):**
- Timeout/wait fixes for elements that haven't appeared yet
- Selector strategy selection (agent decides based on project code)
- Applying the fix (walkthrough handles this)

## Dependencies

- `playwright-cli` v0.1.5+ (installed globally, provides `run-code` and `attach`)
- Browser with `--remote-debugging-port` enabled (standard in walkthrough flow)
