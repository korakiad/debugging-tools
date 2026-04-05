// E2E test using a mock page object with a stale selector.

const { MockPage } = require('./mock-page-object');

describe('Login Form', function () {
    const page = new MockPage();

    it('should click the submit button', async function () {
        // In a real test this would be:
        // await Ws.instance.client.$(page.submitButton).click()
        // Simulating failure: selector doesn't match
        const selector = page.submitButton;
        if (selector === 'button.old-submit-class') {
            throw new Error(
                `Element not found: $('${selector}') - ` +
                'no matching element in the DOM'
            );
        }
    });

    it('should verify login success', function () {
        // This should pass
    });
});
