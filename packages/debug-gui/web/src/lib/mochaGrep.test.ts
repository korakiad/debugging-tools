import { describe, it, expect } from "vitest";
import { mochaGrepFor, escapeRegex } from "./mochaGrep";

describe("mochaGrepFor", () => {
    it("anchors and exact-matches an it node", () => {
        expect(mochaGrepFor({ kind: "it", fullTitle: "A B c" })).toBe("^A B c$");
    });

    it("matches every test under a describe via trailing-space prefix", () => {
        expect(mochaGrepFor({ kind: "describe", fullTitle: "A B" })).toBe("^A B ");
    });

    it("returns null for null input (signals 'run whole file')", () => {
        expect(mochaGrepFor(null)).toBeNull();
    });

    it("returns null when title is empty or dynamic", () => {
        expect(mochaGrepFor({ kind: "it", fullTitle: "" })).toBeNull();
        expect(mochaGrepFor({ kind: "describe", fullTitle: "<dynamic>" })).toBeNull();
        expect(mochaGrepFor({ kind: "it", fullTitle: "x <dynamic> y" })).toBeNull();
    });

    it("escapes regex metacharacters in the title", () => {
        expect(mochaGrepFor({ kind: "it", fullTitle: "renders [foo] (baz)?" })).toBe(
            "^renders \\[foo\\] \\(baz\\)\\?$"
        );
    });
});

describe("escapeRegex", () => {
    it("escapes the regex metacharacter set", () => {
        expect(escapeRegex(".*+?^${}()|[]\\")).toBe(
            "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\"
        );
    });
});
