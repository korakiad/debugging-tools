// Launches Chrome via WDIO standalone with CDP enabled,
// navigates to saucedemo.com, and keeps the session alive
// so playwright-cli can attach and run pick-element.js.
//
// Usage:
//   node test/identify-element/launch-wdio-session.js
//
// Then in another terminal:
//   playwright-cli attach --cdp=http://localhost:9222
//   playwright-cli --raw run-code --filename=.claude/skills/identify-element/references/pick-element.js
//
// Press Ctrl+C to close the browser session.

const { remote } = require('webdriverio');

(async () => {
    const browser = await remote({
        capabilities: {
            browserName: 'chrome',
            'goog:chromeOptions': {
                args: ['--remote-debugging-port=9222']
            }
        },
        waitforTimeout: 5000,
        logLevel: 'warn'
    });

    await browser.url('https://www.saucedemo.com/');
    console.log('Browser ready at https://www.saucedemo.com/');
    console.log('CDP available at http://localhost:9222');
    console.log('');
    console.log('In another terminal, run:');
    console.log('  playwright-cli attach --cdp=http://localhost:9222');
    console.log('  playwright-cli --raw run-code --filename=.claude/skills/identify-element/references/pick-element.js');
    console.log('');
    console.log('Press Ctrl+C to close the session.');

    // Keep alive until Ctrl+C
    process.on('SIGINT', async () => {
        console.log('\nClosing browser session...');
        await browser.deleteSession();
        process.exit(0);
    });

    // Prevent Node from exiting
    await new Promise(() => {});
})();
