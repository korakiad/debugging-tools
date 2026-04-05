// Simulates the Ws.instance.client pattern with a deliberately wrong selector.

class MockPage {
    // This selector is deliberately wrong — the real element uses data-testid
    get submitButton() {
        return 'button.old-submit-class';
    }

    // This is what the fix should look like
    // get submitButton() {
    //     return 'button[data-testid="submit-btn"]';
    // }
}

module.exports = { MockPage };
