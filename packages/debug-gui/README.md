# @debug-tools/ui

Web GUI for walkthrough E2E debug sessions. Lets non-technical QA trigger a Mocha + WebDriverIO run, pauses on the first failure, shows the live DOM, and lets a Copilot agent propose + apply a fix — then auto-retries the test until it passes.

## What you get

- Sidebar lists all specs discovered from your current working directory
- Click Run → the tool spawns `mocha <spec>` with a bundled root-hook injected via `--require`
- Test fails → GUI pauses, shows failure details + stack
- Agent inspects the live browser via CDP, proposes a file edit, you approve it
- Click Continue → Mocha auto-retries the test from the top (up to 5 attempts)
- Multiple broken selectors in one `it()`? Each pause → fix → continue cycle advances through them, no re-click-Run needed

## Prerequisites

- Node ≥ 18
- Chrome browser installed
- GitHub Copilot CLI authenticated (`gh auth login` + active Copilot subscription)
- Your test project uses **Mocha + WebDriverIO standalone** (`remote()` mode, not the wdio testrunner)
- Page objects use **getter methods** returning selector strings (so a fix takes effect on the next retry)

## Install

Until this package is published to an npm registry, install from the bundled tarball.

**Windows** (use bun, not npm — npm global shims on Windows fail under Claude Code's spawn):
```bash
bun install -g ./debug-tools-ui-0.0.1.tgz
```

**macOS / Linux**:
```bash
npm install -g ./debug-tools-ui-0.0.1.tgz
```

Alternatively, run directly from a clone without installing globally:
```bash
git clone https://github.com/korakiad/debugging-tools.git
cd debugging-tools && npm install
npm run build -w @debug-gui/server && npm run build -w @debug-gui/web
# Then invoke bin with an absolute path from your test project
```

## Usage

**The rule: `cd` into YOUR test project first.** The GUI reads mocharc and discovers specs relative to `process.cwd()` — pointing it at the wrong directory produces an empty spec list.

```bash
cd ~/my-qa-project    # your test project, NOT the debugging-tools repo
debug-gui
```

The browser opens at `http://localhost:5555`. Select a spec from the sidebar → Run → triage failures as they surface.

### Custom mocha command

If your project wraps mocha (bin script, wdio preset, custom reporter config), pass the command after `debug-gui`:

```bash
debug-gui ./bin/mocha --timeout 30000
# → the tool spawns: ./bin/mocha --timeout 30000 <selected-spec>
```

Everything before the spec is forwarded verbatim.

### Port

Default is `5555`. Override:
```bash
PORT=6000 debug-gui
```

## How retry works

When a test fails and you approve a fix:
1. The injected `afterEach` hook pauses and polls `/hook/should-continue`
2. You click **Continue** in the GUI
3. Hook returns → Mocha's built-in retry (`this.retries(5)`) replays the test from the top
4. `before` hooks do **not** re-run — your WDIO `browser` session survives across retries
5. If the test still fails (maybe line#2 is also broken), it pauses again showing attempt 2/6
6. After 5 exhausted retries, the test is marked failed and the suite continues

Non-idempotent steps (cart additions, form submissions) may produce duplicate side effects on retry — this is the same limitation Playwright and Cypress have with their retry features. For debugging workflow it's acceptable; for long-term suite health, make steps idempotent where possible.

## Gotchas

- **CDP port 9222 must be free** — Chrome launches with `--remote-debugging-port=9222` so playwright-cli can attach. Close other Chrome instances using that port before running.
- **Copilot auth is required** — the agent session fails to start without an authenticated GitHub Copilot subscription.
- **Windows + npm global bin** — the npm shim (`debug-gui.cmd`) fails to spawn properly when Claude Code runs it. Install with `bun install -g` instead.
- **Spec discovery** — if no specs show in the sidebar, check that your `cwd` is correct and that `debug-gui.config.json` (if present) globs match your test layout.

## Development

See the [repo root README](../../README.md) for clone + build + test instructions, and [CLAUDE.md](../../CLAUDE.md) for architecture.
