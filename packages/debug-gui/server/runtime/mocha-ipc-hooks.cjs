// Mocha root hooks for the debug-gui's bundled walkthrough.
//
// Loaded by mocha-ipc-launcher.cjs which has already created the Mocha
// instance — we attach via mocha.rootHooks() so we share the launcher's
// process.send / process.on('message') channel with no module-load delay.
//
// All cross-process traffic is process.send / process.on('message') frames
// of the WorkerOutbound / WorkerInbound shape (see workerProtocol.ts).

'use strict';

// Continue is a stop+re-fork of the worker, so in-process retry replicates
// nothing useful — same require cache, same suite-level closures, same
// failure. Default to 0 retries: pause once on failure, let QA click
// Continue to swap workers (fresh cache picks up the agent's edit).
// Opt in to in-process retries via DEBUG_GUI_AUTO_RETRY=N for genuine
// runtime flake (timing, network, transient state).
const MAX_RETRIES = parseAutoRetry(process.env.DEBUG_GUI_AUTO_RETRY);

function parseAutoRetry(v) {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Step-style suites can't recover mid-run (state and the in-process
// require cache are both broken once step N fails) — when QA toggles
// "bail on first failure" we (a) skip retries and (b) bail the whole
// tree once afterEach has reported the failure to the GUI.
const BAIL_ON_FAILURE = process.env.DEBUG_GUI_BAIL_ON_FAILURE === '1';

// Frame tracing for diagnostics. Enable with DEBUG_GUI_TRACE_IPC=1 to log
// every send/receive with timestamps to stderr — useful for repro'ing race
// conditions in the pause/resume loop.
const TRACE = process.env.DEBUG_GUI_TRACE_IPC === '1';
function trace(label, payload) {
    if (!TRACE) return;
    try {
        process.stderr.write(
            '[ipc-hook ' + Date.now() + '] ' + label + ' ' + JSON.stringify(payload) + '\n',
        );
    } catch {
        /* tracing must never throw */
    }
}

function send(m) {
    trace('send', m);
    if (process.connected) {
        try {
            process.send(m);
        } catch {
            /* parent IPC pipe already gone */
        }
    }
}

exports.installHooks = function installHooks(mocha, ctx) {
    mocha.rootHooks({
        beforeAll() {
            send({ type: 'status', state: 'running', startedAt: Date.now() });
        },

        beforeEach: function () {
            this.retries(BAIL_ON_FAILURE ? 0 : MAX_RETRIES);
        },

        afterEach: async function () {
            if (this.currentTest.state !== 'failed') return;

            const retryCount = this.currentTest.currentRetry();
            const maxRetries = this.currentTest.retries();

            send({
                type: 'paused',
                failure: {
                    test: this.currentTest.title,
                    suite: this.currentTest.parent && this.currentTest.parent.title,
                    file: this.currentTest.file,
                    error: this.currentTest.err && this.currentTest.err.message,
                    stack: this.currentTest.err && this.currentTest.err.stack,
                    duration: this.currentTest.duration,
                    pausedAt: Date.now(),
                    attempt: retryCount + 1,
                    maxAttempts: maxRetries + 1,
                },
            });

            const decision = await new Promise((resolve) => {
                ctx.currentResume = resolve;
            });
            ctx.currentResume = null;

            if (decision && decision.action === 'stop') {
                if (BAIL_ON_FAILURE) {
                    let s = this.currentTest.parent;
                    while (s) {
                        if (typeof s.bail === 'function') s.bail(true);
                        s = s.parent;
                    }
                }
                throw new Error('stopped by debug-gui');
            }

            send({ type: 'status', state: 'running', resumedAt: Date.now() });
        },

        afterAll() {
            send({ type: 'status', state: 'done', finishedAt: Date.now() });
        },
    });
};

exports.registerIpcHandlers = function registerIpcHandlers(ctx) {
    process.on('message', (msg) => {
        trace('recv', msg);
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'resume' && ctx.currentResume) {
            ctx.currentResume({ action: 'resume' });
        } else if (msg.type === 'stop') {
            // No-op when not paused — the runner-side timeout falls through
            // to killTree() if the worker can't terminate gracefully.
            if (ctx.currentResume) ctx.currentResume({ action: 'stop' });
        }
    });
};
