import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SelfHealBlock, focusedHunk } from "./SelfHealBlock";

describe("focusedHunk", () => {
    it("returns the changed line when one line differs in the middle", () => {
        const before = ["alpha", "beta", "gamma"].join("\n");
        const after = ["alpha", "BETA", "gamma"].join("\n");
        expect(focusedHunk(before, after)).toEqual({
            removed: ["beta"],
            added: ["BETA"],
        });
    });

    it("strips matching prefix and suffix from full-file inputs", () => {
        const before = [
            "class LoginPage {",
            "    get usernameField() { return '#username'; }",
            "    get passwordField() { return 'input.password-field'; }",
            "}",
        ].join("\n");
        const after = [
            "class LoginPage {",
            "    get usernameField() { return '#user-name'; }",
            "    get passwordField() { return 'input.password-field'; }",
            "}",
        ].join("\n");
        expect(focusedHunk(before, after)).toEqual({
            removed: ["    get usernameField() { return '#username'; }"],
            added: ["    get usernameField() { return '#user-name'; }"],
        });
    });

    it("returns single-line inputs verbatim when they differ", () => {
        expect(focusedHunk("button.submit-btn", "button[data-testid=\"login\"]")).toEqual({
            removed: ["button.submit-btn"],
            added: ["button[data-testid=\"login\"]"],
        });
    });

    it("returns empty arrays when content is identical", () => {
        const same = "alpha\nbeta\ngamma";
        expect(focusedHunk(same, same)).toEqual({ removed: [], added: [] });
    });

    it("handles pure additions (no removed lines)", () => {
        const before = "alpha\ngamma";
        const after = "alpha\nbeta\ngamma";
        expect(focusedHunk(before, after)).toEqual({
            removed: [],
            added: ["beta"],
        });
    });

    it("handles pure removals (no added lines)", () => {
        const before = "alpha\nbeta\ngamma";
        const after = "alpha\ngamma";
        expect(focusedHunk(before, after)).toEqual({
            removed: ["beta"],
            added: [],
        });
    });

    it("handles CRLF line endings the same as LF", () => {
        const before = "alpha\r\nbeta\r\ngamma";
        const after = "alpha\r\nBETA\r\ngamma";
        expect(focusedHunk(before, after)).toEqual({
            removed: ["beta"],
            added: ["BETA"],
        });
    });
});

describe("SelfHealBlock rendering", () => {
    it("renders only the changed lines, not the whole file", () => {
        // Reproduces the bug from the screenshot: oldCode and newCode are
        // now full-file payloads (the server sends current vs next file
        // content), so SelfHealBlock must extract just the changed region
        // for the compact log view — otherwise the audit row dumps the
        // entire file.
        const before = [
            "class LoginPage {",
            "    get usernameField() { return '#username'; }",
            "    get passwordField() { return 'input.password-field'; }",
            "    get loginButton() { return '[data-test=\"submit-btn\"]'; }",
            "}",
        ].join("\n");
        const after = [
            "class LoginPage {",
            "    get usernameField() { return '#user-name'; }",
            "    get passwordField() { return 'input.password-field'; }",
            "    get loginButton() { return '[data-test=\"submit-btn\"]'; }",
            "}",
        ].join("\n");
        render(
            <SelfHealBlock
                strategy="agent fix"
                oldCode={before}
                newCode={after}
                filePath="pages/login.page.js"
            />
        );
        const diff = screen.getByLabelText("self-heal diff");
        // The unchanged class declaration / brace / other getters must not
        // be in the rendered diff text — only the changed line should
        // appear, with surrounding context filtered out.
        expect(diff.textContent).toContain("usernameField");
        expect(diff.textContent).toContain("'#username'");
        expect(diff.textContent).toContain("'#user-name'");
        expect(diff.textContent).not.toContain("class LoginPage");
        expect(diff.textContent).not.toContain("passwordField");
        expect(diff.textContent).not.toContain("loginButton");
    });
});
