import { describe, it, expect } from "vitest";
import { selectionToGlobs, isDescendant, withExtensions, DEFAULT_EXT_PATTERN } from "./projection";

describe("selectionToGlobs", () => {
    it("empty selection → empty globs", () => {
        expect(selectionToGlobs({ dirs: [], files: [] })).toEqual([]);
    });

    it("a single file is emitted as its literal path", () => {
        const out = selectionToGlobs({ dirs: [], files: ["test/login.spec.js"] });
        expect(out).toEqual(["test/login.spec.js"]);
    });

    it("a single directory is emitted as a glob with the default ext pattern when no context", () => {
        const out = selectionToGlobs({ dirs: ["test"], files: [] });
        expect(out).toEqual([`test/${DEFAULT_EXT_PATTERN}`]);
    });

    it("reuses the extension pattern from currentGlobs when present", () => {
        const out = selectionToGlobs(
            { dirs: ["e2e"], files: [] },
            { currentGlobs: ["spec/**/*.test.ts"] },
        );
        expect(out).toEqual(["e2e/**/*.test.ts"]);
    });

    it("drops files that are covered by a selected directory", () => {
        const out = selectionToGlobs({
            dirs: ["test"],
            files: ["test/login.spec.js", "other/one.spec.js"],
        });
        expect(out.sort()).toEqual([
            `test/${DEFAULT_EXT_PATTERN}`,
            "other/one.spec.js",
        ].sort());
    });

    it("produces a stable, sorted list (for clean package.json diffs)", () => {
        const out = selectionToGlobs({
            dirs: ["b", "a"],
            files: ["z.spec.js"],
        });
        // sorted: "a/**/*.spec.{js,ts}" < "b/**/*.spec.{js,ts}" < "z.spec.js"
        const sorted = [...out].sort();
        expect(out).toEqual(sorted);
    });

    it("de-duplicates identical entries", () => {
        const out = selectionToGlobs({ dirs: ["a", "a"], files: ["x.js", "x.js"] });
        const unique = [...new Set(out)];
        expect(out.length).toBe(unique.length);
    });
});

describe("extensions override", () => {
    it("uses the explicit extension list over inference when provided", () => {
        const out = selectionToGlobs(
            { dirs: ["e2e"], files: [] },
            { currentGlobs: ["spec/**/*.test.ts"], extensions: ["js"] },
        );
        expect(out).toEqual(["e2e/**/*.test.js"]);
    });

    it("emits brace syntax for multi-extension override", () => {
        const out = selectionToGlobs(
            { dirs: ["test"], files: [] },
            { currentGlobs: [], extensions: ["js", "ts", "tsx"] },
        );
        expect(out).toEqual(["test/**/*.spec.{js,ts,tsx}"]);
    });

    it("single extension → no braces", () => {
        const out = selectionToGlobs(
            { dirs: ["test"], files: [] },
            { currentGlobs: [], extensions: ["ts"] },
        );
        expect(out).toEqual(["test/**/*.spec.ts"]);
    });

    it("empty extensions array falls back to inference/default", () => {
        const out = selectionToGlobs(
            { dirs: ["test"], files: [] },
            { currentGlobs: [], extensions: [] },
        );
        expect(out).toEqual([`test/${DEFAULT_EXT_PATTERN}`]);
    });

    it("accepts extensions with or without leading dot", () => {
        const out = selectionToGlobs(
            { dirs: ["test"], files: [] },
            { currentGlobs: [], extensions: [".js", "ts"] },
        );
        expect(out).toEqual(["test/**/*.spec.{js,ts}"]);
    });
});

describe("withExtensions", () => {
    it("replaces a brace set with a new brace set", () => {
        expect(withExtensions("**/*.spec.{js,ts}", ["js", "ts", "tsx"])).toBe("**/*.spec.{js,ts,tsx}");
    });
    it("replaces a brace set with a single extension (no braces)", () => {
        expect(withExtensions("**/*.spec.{js,ts}", ["ts"])).toBe("**/*.spec.ts");
    });
    it("replaces a single extension with a brace set", () => {
        expect(withExtensions("**/*.test.ts", ["ts", "tsx"])).toBe("**/*.test.{ts,tsx}");
    });
    it("is a no-op when extensions is empty", () => {
        expect(withExtensions("**/*.spec.ts", [])).toBe("**/*.spec.ts");
    });
    it("strips leading dots from extension input", () => {
        expect(withExtensions("**/*.spec.js", [".ts"])).toBe("**/*.spec.ts");
    });
});

describe("isDescendant", () => {
    it("returns true when file is under dir", () => {
        expect(isDescendant("test/login.spec.js", "test")).toBe(true);
        expect(isDescendant("test/ui/button.spec.js", "test/ui")).toBe(true);
    });
    it("returns false when file is outside dir", () => {
        expect(isDescendant("spec/one.js", "test")).toBe(false);
        expect(isDescendant("testing/x.js", "test")).toBe(false); // no false prefix match
    });
    it("treats empty string dir as root (everything is a descendant)", () => {
        expect(isDescendant("any/path.js", "")).toBe(true);
    });
});
