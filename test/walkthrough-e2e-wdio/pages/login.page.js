// Page Object: SauceDemo Login
// All selectors are INTENTIONALLY WRONG to demonstrate /walkthrough debugging.
//
// Real selectors (for reference — the agent should discover these via CDP):
//   username:     #user-name
//   password:     #password
//   loginButton:  [data-test="login-button"]

class LoginPage {
    get url() { return 'https://www.saucedemo.com/'; }

    // WRONG: real id is "user-name" (with hyphen)
    get usernameField() { return '#username'; }

    // WRONG: no such class — real element is #password
    get passwordField() { return 'input.password-field'; }

    // WRONG: data-test value is "login-button", not "submit-btn"
    get loginButton() { return '[data-test="submit-btn"]'; }
}

module.exports = { LoginPage };
