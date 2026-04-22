// Mocha Root Hook Plugin — bundled with @debug-tools/ui (v2, HTTP IPC).
//
// Runs INSIDE the test process spawned by debug-gui's runner.ts.
// Talks to the debug-gui server over HTTP on 127.0.0.1:${DEBUG_GUI_PORT}.
//
// Lifecycle (hybrid pattern — HTTP for state, PID for death):
//   • beforeAll    → POST /hook/status (running), start watchdog
//   • afterEach    → if failed: POST /hook/paused + poll /hook/should-continue
//   • afterAll     → POST /hook/status (done), stop watchdog
//   • every 500ms  → heartbeat POST + isParentAlive() check → shouldAbort()
//
// This hook is the CLIENT; the debug-gui Express server is the source of truth.
// When the server dies or the QA closes the GUI, HTTP fails AND PID check fails.
// shouldAbort() decides when/how to exit based on both signals.

const GUI_PORT = process.env.DEBUG_GUI_PORT;
const GUI_PID = process.env.DEBUG_GUI_PID ? Number(process.env.DEBUG_GUI_PID) : null;
const GUI_BASE = GUI_PORT ? `http://127.0.0.1:${GUI_PORT}` : null;
const POLL_INTERVAL_MS = 500;
const HTTP_TIMEOUT_MS = 1000;

// Max retries per test. Mocha re-runs beforeEach+test+afterEach for each retry
// (but NOT before/after — browser session survives). Each retry pauses again on
// failure so the agent can propose another fix. Cap prevents infinite loops
// when the fix keeps missing.
const MAX_RETRIES = 5;

let consecutiveFailures = 0;
let lastSeenAt = Date.now();
let watchdogTimer = null;

// Pattern 2 (LSP-style): OS-level parent liveness probe.
// process.kill(pid, 0) doesn't actually signal — it checks existence + permission.
//   pid alive         → no throw, return true
//   pid gone (ESRCH)  → throw, return false
//   permission denied → throw EPERM, treat as alive (optimistic)
function isParentAlive() {
    if (!GUI_PID) return true; // env not wired — can't check, assume alive
    try {
        process.kill(GUI_PID, 0);
        return true;
    } catch (e) {
        return e.code !== 'ESRCH';
    }
}

async function httpPost(path, body) {
    if (!GUI_BASE) return null;
    try {
        const res = await fetch(`${GUI_BASE}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`${path} → ${res.status}`);
        consecutiveFailures = 0;
        lastSeenAt = Date.now();
        return await res.json().catch(() => ({}));
    } catch {
        consecutiveFailures++;
        return null;
    }
}

async function httpGet(path) {
    if (!GUI_BASE) return null;
    try {
        const res = await fetch(`${GUI_BASE}${path}`, {
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`${path} → ${res.status}`);
        consecutiveFailures = 0;
        lastSeenAt = Date.now();
        return await res.json();
    } catch {
        consecutiveFailures++;
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Abort policy — called every POLL_INTERVAL_MS (500ms).
//
// Decides: should this test process bail because the gui server is gone?
//
// Inputs (module closure):
//   consecutiveFailures  — back-to-back HTTP fails (0 = last call ok)
//   lastSeenAt           — ms timestamp of last successful server contact
//   isParentAlive()      — OS-level PID probe (false = OS-confirmed dead)
//
// Returns null (keep running) or { code, message } (exit via process.exit).
//
// Default policy from design discussion — "short grace + distinctive exit code":
//   • OS-confirmed death    → bail immediately (fastest, most reliable signal)
//   • 3 HTTP fails (~1.5s)  → bail (server hung or crashed without OS-level cleanup)
//   • Exit code 187         — not POSIX-reserved (128-165), not Mocha's (1, 7),
//                             3-digit and distinctive in CI log greps.
//
// To tune: adjust the 3-fail threshold or pick a different exit code.
function shouldAbort() {
    if (!isParentAlive()) {
        return {
            code: 187,
            message: 'debug-gui server process gone — aborting test run',
        };
    }
    if (consecutiveFailures >= 3) {
        const silentMs = Date.now() - lastSeenAt;
        return {
            code: 187,
            message: `debug-gui unreachable for ${silentMs}ms — aborting test run`,
        };
    }
    return null;
}
// ─────────────────────────────────────────────────────────────────────────────

function checkAndMaybeExit() {
    const decision = shouldAbort();
    if (!decision) return;
    try {
        process.stderr.write(`\n[walkthrough] ${decision.message}\n`);
    } catch { /* stderr may be closed */ }
    process.exit(decision.code);
}

async function heartbeat() {
    // Fire HTTP heartbeat to update consecutiveFailures / lastSeenAt.
    // Even if server ignores /hook/heartbeat, the TCP connect succeeds/fails —
    // which is all shouldAbort() needs to know.
    await httpPost('/hook/heartbeat', { pid: process.pid, at: Date.now() });
    checkAndMaybeExit();
}

exports.mochaHooks = {
    async beforeAll() {
        await httpPost('/hook/status', { state: 'running', startedAt: Date.now() });
        watchdogTimer = setInterval(heartbeat, POLL_INTERVAL_MS);
        // Unref so the watchdog doesn't hold the event loop open on a clean exit.
        if (typeof watchdogTimer.unref === 'function') watchdogTimer.unref();
    },

    // Opt every test into retries so that after the agent's fix is approved,
    // Mocha replays the whole it() from the top — giving line#2 a chance to
    // run once line#1's selector is healed. Without this, afterEach would
    // return, Mocha would mark failed and move to the next test, and QA would
    // have to click Run again just to discover the next broken line.
    beforeEach: function () {
        this.retries(MAX_RETRIES);
    },

    afterEach: async function () {
        if (this.currentTest.state !== 'failed') return;

        // Mocha uses 0-indexed retries; humans expect 1-indexed attempt counts.
        const retryCount = this.currentTest.currentRetry();
        const maxRetries = this.currentTest.retries();

        await httpPost('/hook/paused', {
            test: this.currentTest.title,
            suite: this.currentTest.parent?.title,
            file: this.currentTest.file,
            error: this.currentTest.err?.message,
            stack: this.currentTest.err?.stack,
            duration: this.currentTest.duration,
            pausedAt: Date.now(),
            attempt: retryCount + 1,
            maxAttempts: maxRetries + 1,
        });

        // Block until server signals continue OR policy decides to abort.
        // The watchdog keeps ticking in parallel — either path exits the loop.
        while (true) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            const resp = await httpGet('/hook/should-continue');
            if (resp && resp.shouldContinue === true) break;
            checkAndMaybeExit();
        }

        await httpPost('/hook/status', { state: 'running', resumedAt: Date.now() });
    },

    async afterAll() {
        if (watchdogTimer) clearInterval(watchdogTimer);
        await httpPost('/hook/status', { state: 'done', finishedAt: Date.now() });
    },
};
