// E2E: Refinitiv Workspace — IBM RIC prompt returns chart response.
//
// Mocha + WDIO standalone (browser global injected by wdio-setup.js).
// Converted from a Playwright spec; ai.* assertions are replaced with
// plain waits / DOM checks per project conventions.

const { RefinitivWorkspacePage } = require('./pages/refinitivWorkspace.page');

describe('Refinitiv Workspace AI', function () {
    this.timeout(180_000);
    const page = new RefinitivWorkspacePage();

    before(function () {
        if (!process.env.REFINITIV_USER || !process.env.REFINITIV_PASSWORD) {
            throw new Error('REFINITIV_USER and REFINITIV_PASSWORD env variables are required');
        }
    });

    it('logs into Workspace', async function () {
        await browser.url(page.url);

        const username = await browser.$(page.usernameField);
        await username.waitForDisplayed({ timeout: 30_000 });
        await username.setValue(process.env.REFINITIV_USER);

        const password = await browser.$(page.passwordField);
        await password.setValue(process.env.REFINITIV_PASSWORD);

        const signIn = await browser.$(page.signInButton);
        await signIn.click();

        // Wait for Workspace shell to finish booting (slow PPE environment).
        await browser.pause(30_000);
    });

    it('opens the Workspace AI panel', async function () {
        // Frame chain: AppFrame → internal → AppFrame
        await browser.switchToParentFrame();
        await browser.switchToFrame(null); // back to top
        await browser.switchToFrame(await browser.$(page.outerAppFrame));
        await browser.switchToFrame(await browser.$(page.internalFrame));
        await browser.switchToFrame(await browser.$(page.innerAppFrame));

        const aiBtn = await browser.$(page.aiButton);
        await aiBtn.waitForClickable({ timeout: 30_000 });
        await aiBtn.click();
    });

    it('submits IBM.N prompt and verifies response mentions IBM', async function () {
        // Already inside the inner Workspace AppFrame; descend into AI app frame.
        await browser.switchToFrame(await browser.$(page.aiAppFrame));

        const input = await browser.$(page.askInput);
        await input.waitForDisplayed({ timeout: 30_000 });
        await input.setValue('Show me IBM.N chart');

        const send = await browser.$(page.sendButton);
        await send.click();

        // Replacement for ai.expect(...): wait until the AI panel renders
        // text that mentions IBM (chart / company overview / financials).
        await browser.waitUntil(
            async () => {
                const body = await browser.$('body');
                const text = await body.getText();
                return /IBM|International Business Machines/i.test(text);
            },
            {
                timeout: 60_000,
                interval: 5_000,
                timeoutMsg: 'AI response did not mention IBM within 60s',
            },
        );

        // Restore frame context for any subsequent specs.
        await browser.switchToFrame(null);
    });
});
