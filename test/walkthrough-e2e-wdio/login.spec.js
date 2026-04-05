// E2E Login Test — saucedemo.com
// Uses intentionally wrong selectors to trigger walkthrough pause-inspect-fix cycles.

const { LoginPage } = require('./pages/login.page');

describe('SauceDemo Login', function () {
    this.timeout(30000);
    const loginPage = new LoginPage();

    before(async function () {
        await browser.url(loginPage.url);
    });

    it('should enter username', async function () {
        // Wrong selector: #username — real is #user-name
        const el = await browser.$(loginPage.usernameField);
        await el.setValue('standard_user');
    });

    it('should enter password', async function () {
        // Wrong selector: input.password-field — real is #password
        const el = await browser.$(loginPage.passwordField);
        await el.setValue('secret_sauce');
    });

    it('should click login button', async function () {
        // Wrong selector: [data-test="submit-btn"] — real is [data-test="login-button"]
        const el = await browser.$(loginPage.loginButton);
        await el.click();
    });
});
