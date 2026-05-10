import { describe, it, expect } from "vitest";
import { parseTestTitle, matchesQuery } from "./parseTestTitle";

describe("parseTestTitle", () => {
    it("extracts caseId, displayTitle, and tags from a typical LSEG title", () => {
        const r = parseTestTitle(
            "C1111111 - Example Company Overview - Business Summary [Regression][Smoke][Cl_Regression][Cl_Smoke]",
        );
        expect(r.caseId).toBe("C1111111");
        expect(r.displayTitle).toBe("Example Company Overview - Business Summary");
        expect(r.tags).toEqual(["Regression", "Smoke", "Cl_Regression", "Cl_Smoke"]);
        expect(r.raw).toBe(
            "C1111111 - Example Company Overview - Business Summary [Regression][Smoke][Cl_Regression][Cl_Smoke]",
        );
    });

    it("returns the title unchanged when there is no caseId or tags", () => {
        const r = parseTestTitle("should enter username");
        expect(r.caseId).toBeNull();
        expect(r.displayTitle).toBe("should enter username");
        expect(r.tags).toEqual([]);
    });

    it("handles caseId with no whitespace before the hyphen", () => {
        const r = parseTestTitle("C123-Foo");
        expect(r.caseId).toBe("C123");
        expect(r.displayTitle).toBe("Foo");
        expect(r.tags).toEqual([]);
    });

    it("normalizes caseId casing to upper-case", () => {
        const r = parseTestTitle("c4444444 - lower-case prefix [Smoke]");
        expect(r.caseId).toBe("C4444444");
        expect(r.tags).toEqual(["Smoke"]);
    });

    it("preserves the dynamic-title sentinel verbatim", () => {
        const r = parseTestTitle("<dynamic>");
        expect(r.caseId).toBeNull();
        expect(r.displayTitle).toBe("<dynamic>");
        expect(r.tags).toEqual([]);
        expect(r.raw).toBe("<dynamic>");
    });

    it("preserves the missing-title sentinel verbatim", () => {
        const r = parseTestTitle("<missing>");
        expect(r.displayTitle).toBe("<missing>");
        expect(r.tags).toEqual([]);
    });

    it("falls back to raw when stripping leaves an empty label", () => {
        const r = parseTestTitle("[OnlyTags][AndMore]");
        expect(r.caseId).toBeNull();
        expect(r.displayTitle).toBe("[OnlyTags][AndMore]");
        // Tags are dropped so the row matches what the user actually sees.
        expect(r.tags).toEqual([]);
    });

    it("collapses extra whitespace left where tags used to be", () => {
        const r = parseTestTitle("Move to Ownership   [Regression]   [Smoke]");
        expect(r.displayTitle).toBe("Move to Ownership");
        expect(r.tags).toEqual(["Regression", "Smoke"]);
    });

    it("handles an empty string", () => {
        const r = parseTestTitle("");
        expect(r.caseId).toBeNull();
        expect(r.displayTitle).toBe("");
        expect(r.tags).toEqual([]);
    });
});

describe("matchesQuery", () => {
    const parsed = parseTestTitle(
        "C5555555 - Equities : time zone [Regression][Smoke][Cl_Regression][Cl_Smoke]",
    );

    it("returns true for an empty needle", () => {
        expect(matchesQuery(parsed, "")).toBe(true);
    });

    it("matches against the displayTitle", () => {
        expect(matchesQuery(parsed, "equities")).toBe(true);
        expect(matchesQuery(parsed, "time zone")).toBe(true);
    });

    it("matches against the caseId", () => {
        expect(matchesQuery(parsed, "c5555555")).toBe(true);
    });

    it("matches against tags even though they are visually hidden", () => {
        expect(matchesQuery(parsed, "smoke")).toBe(true);
        expect(matchesQuery(parsed, "cl_regression")).toBe(true);
    });

    it("returns false when the needle is absent everywhere", () => {
        expect(matchesQuery(parsed, "alarm")).toBe(false);
    });
});
