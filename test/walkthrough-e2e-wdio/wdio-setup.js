// Mocha root hook: launches Chrome via WDIO remote() before tests,
// tears down after. Exposes browser as global for specs.

const fs = require('fs');
const path = require('path');
const { remote } = require('webdriverio');

// Load `.env` from repo root into process.env (no dotenv dependency).
// Existing env vars win, so CI-provided values override the file.
function loadDotenv() {
    const envPath = path.resolve(__dirname, '..', '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}
loadDotenv();

let browser;

exports.mochaHooks = {
    async beforeAll() {
        browser = await remote({
            capabilities: {
                browserName: 'chrome',
                'goog:chromeOptions': {
                    args: ['--remote-debugging-port=9222']
                }
            },
            waitforTimeout: 5000,
            logLevel: 'warn'
        });
        global.browser = browser;
    },

    async afterAll() {
        if (browser) {
            await browser.deleteSession();
        }
    }
};
