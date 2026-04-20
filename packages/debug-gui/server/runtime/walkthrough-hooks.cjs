// Mocha Root Hook Plugin — bundled with @debug-tools/ui.
// Injected at spawn time by debug-gui's runner.ts via --require.
// Pauses test execution on failure, waits for the UI to signal continue
// through the filesystem protocol under <cwd>/.walkthrough/.

const fs = require('fs');
const path = require('path');

const SIGNAL_DIR = path.join(process.cwd(), '.walkthrough');
const PAUSED_FILE = path.join(SIGNAL_DIR, 'paused.json');
const CONTINUE_FILE = path.join(SIGNAL_DIR, 'continue');
const POLL_INTERVAL_MS = 500;

function ensureDir() {
    if (!fs.existsSync(SIGNAL_DIR)) {
        fs.mkdirSync(SIGNAL_DIR, { recursive: true });
    }
}

exports.mochaHooks = {
    beforeAll() {
        if (fs.existsSync(SIGNAL_DIR)) {
            try { fs.rmSync(SIGNAL_DIR, { recursive: true }); } catch {}
        }
        fs.mkdirSync(SIGNAL_DIR, { recursive: true });
        fs.writeFileSync(
            path.join(SIGNAL_DIR, 'status.json'),
            JSON.stringify({ state: 'running', startedAt: Date.now() })
        );
    },

    afterEach: async function () {
        if (this.currentTest.state === 'failed') {
            ensureDir();
            fs.writeFileSync(PAUSED_FILE, JSON.stringify({
                test: this.currentTest.title,
                suite: this.currentTest.parent?.title,
                file: this.currentTest.file,
                error: this.currentTest.err?.message,
                stack: this.currentTest.err?.stack,
                duration: this.currentTest.duration,
                pausedAt: Date.now()
            }, null, 2));
            fs.writeFileSync(
                path.join(SIGNAL_DIR, 'status.json'),
                JSON.stringify({ state: 'paused', pausedAt: Date.now() })
            );

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

            ensureDir();
            fs.writeFileSync(
                path.join(SIGNAL_DIR, 'status.json'),
                JSON.stringify({ state: 'running', resumedAt: Date.now() })
            );
        }
    },

    afterAll() {
        ensureDir();
        fs.writeFileSync(
            path.join(SIGNAL_DIR, 'status.json'),
            JSON.stringify({ state: 'done', finishedAt: Date.now() })
        );
    }
};
