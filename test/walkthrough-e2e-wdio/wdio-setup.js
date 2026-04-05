// Mocha root hook: launches Chrome via WDIO remote() before tests,
// tears down after. Exposes browser as global for specs.

const { remote } = require('webdriverio');

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
