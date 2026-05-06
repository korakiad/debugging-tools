// Page Object: SauceDemo Login
// All selectors are INTENTIONALLY WRONG to demonstrate /walkthrough debugging.
//
// Real selectors (for reference — the agent should discover these via CDP):
//   username:     #user-name
//   password:     #password
//   loginButton:  [data-test="login-button"]

class LoginPage {
  get url() {
    return "https://www.saucedemo.com/";
  }

  // Fixed: username field selector
  get usernameField() {
    return "#user-name";
  }

  // Fixed: password field selector
  get passwordField() {
    return "inputXX#password";
  }

  // Fixed: login button selector
  get loginButton() {
    return '[data-test="login-button"]';
  }
}

module.exports = { LoginPage };
