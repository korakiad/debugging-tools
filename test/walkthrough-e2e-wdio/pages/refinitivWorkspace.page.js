// Page Object: Refinitiv Workspace login + AI App
//
// Frame chain to reach the AI App (deeply nested):
//   AppFrame → internal → AppFrame → EikonNowMarker[src*="workspace-ai-app"]

class RefinitivWorkspacePage {
  get url() {
    return 'http://workspace.ppe.refinitiv.com/web';
  }

  // --- Login screen (top-level document) ---
  get usernameField() {
    return '#AAA-AS-SI1-SE003';
  }

  get passwordField() {
    return '#AAA-AS-SI1-SE006';
  }

  get signInButton() {
    return '#AAA-AS-SI1-SE014';
  }

  // --- Frame names (used with switchToFrame) ---
  // Note: Use iframe[id] when available to avoid ambiguity with multiple same-name iframes
  get outerAppFrame() {
    return 'iframe[name="AppFrame"][src*="/rap/webcontainer/"]';
  }

  get internalFrame() {
    return 'iframe#contentframe';
  }

  get innerAppFrame() {
    return 'iframe[id="AppFrame"]';
  }

  get aiAppFrame() {
    return 'iframe[name="EikonNowMarker"][src*="workspace-ai-app"]';
  }

  // --- Inside the Workspace inner AppFrame ---
  get aiButton() {
    return '#chat-copilot';
  }

  // --- Inside the AI App frame ---
  get askInput() {
    return 'textbox[name="Ask a question"], [aria-label="Ask a question"], input[placeholder*="Ask"]';
  }

  get sendButton() {
    return 'button[name="Send"], button[aria-label="Send"]';
  }
}

module.exports = { RefinitivWorkspacePage };
