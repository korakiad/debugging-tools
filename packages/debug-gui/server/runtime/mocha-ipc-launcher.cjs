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
process.on('disconnect', () => {
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
    try {
        if (typeof global !== 'undefined' && global.browser && typeof global.browser.deleteSession === 'function') {
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

// Hard cap on total runtime so a wedged WDIO session can't hold the worker
// alive after the GUI is gone. unref() so it doesn't block a clean exit.
setTimeout(() => process.exit(0), ctx.forceExitMs).unref();
