import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CodePreview, languageFromPath, sliceSource } from "./CodePreview";

describe("CodePreview", () => {
    it("renders the code with line numbers starting at startLine", () => {
        render(<CodePreview code={"const x = 1;\nconst y = 2;"} startLine={42} />);
        const pre = screen.getByTestId("code-preview");
        expect(pre.textContent).toContain("42");
        expect(pre.textContent).toContain("43");
        expect(pre.textContent).toContain("const x = 1;");
        expect(pre.textContent).toContain("const y = 2;");
    });

    it("renders the title when provided", () => {
        render(<CodePreview code={"// hi"} startLine={1} title="path/to/file.spec.ts:10" />);
        expect(screen.getByText("path/to/file.spec.ts:10")).toBeInTheDocument();
    });
});

describe("languageFromPath", () => {
    it("maps each spec extension to a Prism grammar", () => {
        expect(languageFromPath("foo.tsx")).toBe("tsx");
        expect(languageFromPath("foo.jsx")).toBe("jsx");
        expect(languageFromPath("a/b.spec.ts")).toBe("typescript");
        expect(languageFromPath("a/b.spec.js")).toBe("javascript");
        expect(languageFromPath("a/b.spec.cjs")).toBe("javascript");
        expect(languageFromPath("a/b.spec.mjs")).toBe("javascript");
        expect(languageFromPath("a/b.spec.unknown")).toBe("tsx");
    });
});

describe("sliceSource", () => {
    const src = ["L1", "L2", "L3", "L4", "L5"].join("\n");

    it("slices the requested 1-based inclusive line range", () => {
        expect(sliceSource(src, 2, 4)).toBe("L2\nL3\nL4");
    });

    it("handles single-line ranges", () => {
        expect(sliceSource(src, 1, 1)).toBe("L1");
    });

    it("returns null for missing source", () => {
        expect(sliceSource(undefined, 1, 1)).toBeNull();
    });

    it("returns null when endLine < startLine or startLine < 1", () => {
        expect(sliceSource(src, 4, 2)).toBeNull();
        expect(sliceSource(src, 0, 1)).toBeNull();
    });
});
