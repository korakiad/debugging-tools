import { describe, it, expect } from "vitest";
import { findNode } from "./findNode";
import type { SuiteTree } from "../state/store";

const tree: SuiteTree = {
    file: "/x/a.spec.js",
    relPath: "a.spec.js",
    source: "",
    children: [
        {
            kind: "describe",
            title: "Outer",
            fullTitle: "Outer",
            line: 1,
            endLine: 10,
            children: [
                { kind: "it", title: "alpha", fullTitle: "Outer alpha", line: 2, endLine: 3, children: [] },
                {
                    kind: "describe",
                    title: "Inner",
                    fullTitle: "Outer Inner",
                    line: 4,
                    endLine: 9,
                    children: [
                        { kind: "it", title: "beta", fullTitle: "Outer Inner beta", line: 5, endLine: 6, children: [] },
                    ],
                },
            ],
        },
    ],
};

describe("findNode", () => {
    it("finds a top-level describe", () => {
        const n = findNode(tree, { kind: "describe", fullTitle: "Outer" });
        expect(n?.title).toBe("Outer");
    });

    it("finds a nested describe", () => {
        const n = findNode(tree, { kind: "describe", fullTitle: "Outer Inner" });
        expect(n?.title).toBe("Inner");
    });

    it("finds a nested it", () => {
        const n = findNode(tree, { kind: "it", fullTitle: "Outer Inner beta" });
        expect(n?.title).toBe("beta");
        expect(n?.line).toBe(5);
        expect(n?.endLine).toBe(6);
    });

    it("returns null when the selection has no match", () => {
        expect(findNode(tree, { kind: "it", fullTitle: "missing" })).toBeNull();
    });

    it("returns null on null tree or null selection", () => {
        expect(findNode(undefined, { kind: "it", fullTitle: "x" })).toBeNull();
        expect(findNode(tree, null)).toBeNull();
    });
});
