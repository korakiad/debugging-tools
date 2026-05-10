// Forked entry point for the v3 Node-IPC pause/resume channel.
//
// Spawned by MochaIpcRunner via child_process.fork(...,
//   { stdio: ['ignore','pipe','pipe','ipc'] }). Boots Mocha programmatically
// instead of via the CLI so we can register root hooks + IPC handlers in the
// same process before any user spec loads. Talks to the parent over the
// Node IPC channel only — no HTTP, no PID polling, no exit-187.

'use strict';

const Mocha = require('mocha');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { installHooks, registerIpcHandlers } = require('./mocha-ipc-hooks.cjs');

// Server-managed Chrome handoff. When DEBUG_GUI_ATTACH_CDP is set (the
// debug-gui server has launched its own Chrome and wants every fork to
// attach to it instead of launching), monkey-patch webdriverio.remote()
// to inject `goog:chromeOptions.debuggerAddress`. This converts the
// consumer's `remote({...})` from launch-mode to attach-mode without
// requiring any change to their wdio-setup.js — survives across
// re-forks on Continue, preserving login/navigation state.
//
// Must run BEFORE loadConsumerRequires() requires wdio-setup.js
// (which in turn requires webdriverio).
patchWebdriverIORemoteIfAttach();

function patchWebdriverIORemoteIfAttach() {
    const attach = process.env.DEBUG_GUI_ATTACH_CDP;
    if (!attach) return;
    let wdio;
    try {
        wdio = require('webdriverio');
    } catch {
        // Consumer doesn't use webdriverio — patch is a no-op. Other
        // browser libraries are out of scope for v1.
        return;
    }
    if (!wdio || typeof wdio.remote !== 'function' || wdio.__dguiPatched) return;
    const origRemote = wdio.remote;
    wdio.remote = async function patchedRemote(opts, ...rest) {
        try {
            opts = opts || {};
            opts.capabilities = opts.capabilities || {};
            const chromeOpts = { ...(opts.capabilities['goog:chromeOptions'] || {}) };
            chromeOpts.debuggerAddress = attach;
            // Strip launch-only args; Chrome is already running and Chrome
            // ignores them on attach, but pruning makes the cap diff clear.
            if (chromeOpts.args) delete chromeOpts.args;
            opts.capabilities['goog:chromeOptions'] = chromeOpts;
        } catch {
            /* fall through to origRemote with original opts */
        }
        const browser = await origRemote(opts, ...rest);
        // Defense-in-depth wrap of deleteSession: in chromedriver's
        // debuggerAddress mode, deleteSession already does NOT kill the
        // attached Chrome (chromedriver detects the external browser and
        // skips Quit's process-close path), so the unwrapped call is
        // benign. We only attempt to wrap in case a future WDIO/driver
        // combo regresses that behavior.
        //
        // WebdriverIO's Browser object is a Proxy and may treat method
        // assignments as read-only ("Cannot assign to read only
        // property 'deleteSession'"). Try Object.defineProperty as a
        // fallback; if BOTH fail, skip the wrap entirely and rely on
        // chromedriver's attach-mode behavior. Never throw out of
        // patchedRemote — beforeAll would fail and Run is dead.
        if (browser && typeof browser.deleteSession === 'function') {
            try {
                const origDelete = browser.deleteSession.bind(browser);
                const patched = async function patchedDeleteSession() {
                    try {
                        return await origDelete({ shutdownDriver: false });
                    } catch {
                        return undefined;
                    }
                };
                try {
                    browser.deleteSession = patched;
                } catch {
                    Object.defineProperty(browser, 'deleteSession', {
                        value: patched,
                        configurable: true,
                        writable: true,
                    });
                }
            } catch {
                /* Browser proxy refuses both paths; trust chromedriver's
                   attach-mode deleteSession to leave Chrome alive. */
            }
        }
        return browser;
    };
    wdio.__dguiPatched = true;
}

function parseArgv(args) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const k = args[i];
        if (k === '--spec') out.spec = args[++i];
        else if (k === '--grep') out.grep = args[++i];
        else if (k === '--timeout') out.timeout = Number(args[++i]);
    }
    return out;
}

const argv = parseArgv(process.argv.slice(2));
const mocha = new Mocha({
    timeout: typeof argv.timeout === 'number' && Number.isFinite(argv.timeout) ? argv.timeout : 0,
    reporter: 'spec',
});
if (argv.grep) mocha.grep(new RegExp(argv.grep));
if (argv.spec) mocha.addFile(path.resolve(argv.spec));

const ctx = {
    currentResume: null,
    forceExitMs: Number(process.env.DEBUG_GUI_FORCE_EXIT_TIMEOUT_MS || 30000),
};

installHooks(mocha, ctx);
registerIpcHandlers(ctx);

// Parent-death detection: the IPC channel closes when the parent exits, which
// fires 'disconnect' here. Mirrors Playwright's processHost → process.ts:68.
//
// The hard force-exit cap is armed HERE (not at module load) because the
// previous unconditional setTimeout would kill the worker mid-pause: a QA
// debug session that takes >30s (agent investigating, picking elements,
// awaiting ask_user) hit process.exit before resume — which then nulled
// currentAgentSession in the GUI server, and every subsequent ask_user /
// edit_file call rejected with "agent session torn down". The cap only
// makes sense once the parent is actually gone.
process.on('disconnect', () => {
    setTimeout(() => process.exit(0), ctx.forceExitMs).unref();
    gracefulCloseAndExit(ctx);
});

(async () => {
    try {
        // Replicate Mocha CLI's `--require` autoload from the consumer's
        // package.json `mocha.require` field. The CLI does this transparently
        // (lib/cli/options.js → handleRequires); programmatic Mocha does not,
        // which broke wdio-setup.js's `global.browser` injection in IPC mode.
        await loadConsumerRequires(mocha, process.cwd());
        await mocha.loadFilesAsync();
        mocha.run((failures) => {
            try {
                if (process.connected) process.send({ type: 'done', failures });
            } catch {
                /* parent already gone */
            }
            // Small drain so the IPC frame leaves the queue before exit.
            setTimeout(() => process.exit(failures ? 1 : 0), 50);
        });
    } catch (e) {
        try {
            process.stderr.write(`\n[mocha-ipc-launcher] load error: ${(e && e.stack) || e}\n`);
        } catch {
            /* stderr may be closed */
        }
        try {
            if (process.connected) process.send({ type: 'done', failures: 1 });
        } catch {
            /* ignore */
        }
        process.exit(1);
    }
})();

// Mirror of Mocha CLI's `--require <file>` semantics for programmatic boot.
// Reads the consumer's package.json `mocha.require` (the only RC source the
// debug-gui consumers use today) and require()/import()'s each entry, then
// forwards any exported `mochaHooks` plugin to mocha.rootHooks() so root
// hooks like wdio-setup.js's beforeAll/afterAll attach to the suite.
//
// Phase 2 scope: package.json only. Phase 3 can extend to .mocharc.{cjs,js,
// json} if a consumer needs them.
async function loadConsumerRequires(mocha, cwd) {
    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    } catch {
        return;
    }
    const reqs = pkg && pkg.mocha && pkg.mocha.require;
    if (!reqs) return;
    const list = Array.isArray(reqs) ? reqs : [reqs];

    for (const r of list) {
        if (typeof r !== 'string') continue;
        const abs = path.isAbsolute(r) ? r : path.resolve(cwd, r);
        let mod;
        try {
            if (abs.endsWith('.mjs')) {
                mod = await import(pathToFileURL(abs).href);
            } else {
                // .js / .cjs — Node's require resolution + the consumer's
                // package "type" field decide CJS vs ESM. require() throws
                // ERR_REQUIRE_ESM on a true ESM module; we surface that
                // rather than silently skipping the require.
                mod = require(abs);
            }
        } catch (e) {
            try {
                process.stderr.write(
                    `\n[mocha-ipc-launcher] failed to require ${r}: ${(e && e.stack) || e}\n`,
                );
            } catch {
                /* stderr may be closed */
            }
            throw e;
        }
        const hooks = mod && (mod.mochaHooks || (mod.default && mod.default.mochaHooks));
        if (hooks) mocha.rootHooks(hooks);
    }
}

async function gracefulCloseAndExit(closeCtx) {
    try {
        closeCtx.currentResume?.({ action: 'stop' });
    } catch {
        /* resume handler already cleared */
    }
    // Skip deleteSession when the server owns Chrome (DEBUG_GUI_ATTACH_CDP
    // set). Worker is exiting because the parent died; the server will
    // (or already did) tear Chrome down on its way out. Calling
    // deleteSession here is wasted work and risks racing the server's kill.
    try {
        if (
            !process.env.DEBUG_GUI_ATTACH_CDP &&
            typeof global !== 'undefined' &&
            global.browser &&
            typeof global.browser.deleteSession === 'function'
        ) {
            await Promise.race([
                Promise.resolve()
                    .then(() => global.browser.deleteSession())
                    .catch(() => {}),
                new Promise((r) => setTimeout(r, 5000)),
            ]);
        }
    } catch {
        /* swallow — we're tearing down anyway */
    }
    process.exit(0);
}

