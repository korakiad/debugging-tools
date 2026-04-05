// Mocha Root Hook Plugin for /walkthrough debug sessions
// Injected via: mocha <spec> --require <path-to-this-file>
// Pauses test execution on failure, waits for agent to signal continue.

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
        // Clean up stale signals from previous runs
        if (fs.existsSync(SIGNAL_DIR)) {
            try { fs.rmSync(SIGNAL_DIR, { recursive: true }); } catch {}
        }
        fs.mkdirSync(SIGNAL_DIR, { recursive: true });

        // Write a "started" signal so agent knows tests are running
        fs.writeFileSync(
            path.join(SIGNAL_DIR, 'status.json'),
            JSON.stringify({ state: 'running', startedAt: Date.now() })
        );
    },

    afterEach: async function () {
        if (this.currentTest.state === 'failed') {
            ensureDir();

            // Write failure details for agent to read
            fs.writeFileSync(PAUSED_FILE, JSON.stringify({
                test: this.currentTest.title,
                suite: this.currentTest.parent?.title,
                file: this.currentTest.file,
                error: this.currentTest.err?.message,
                stack: this.currentTest.err?.stack,
                duration: this.currentTest.duration,
                pausedAt: Date.now()
            }, null, 2));

            // Update status
            fs.writeFileSync(
                path.join(SIGNAL_DIR, 'status.json'),
                JSON.stringify({ state: 'paused', pausedAt: Date.now() })
            );

            // Block until agent writes the continue signal
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

            // Update status back to running
            ensureDir();
            fs.writeFileSync(
                path.join(SIGNAL_DIR, 'status.json'),
                JSON.stringify({ state: 'running', resumedAt: Date.now() })
            );
        }
    },

    afterAll() {
        ensureDir();
        // Write completion signal
        fs.writeFileSync(
            path.join(SIGNAL_DIR, 'status.json'),
            JSON.stringify({ state: 'done', finishedAt: Date.now() })
        );
    }
};
