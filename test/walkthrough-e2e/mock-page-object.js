// Simulates the Ws.instance.client pattern with a deliberately wrong selector.

class MockPage {
  get submitButton() {
    return "button.old-submit-class";
  }
}

module.exports = { MockPage };
