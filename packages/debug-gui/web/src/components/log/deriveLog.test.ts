import { describe, it, expect } from "vitest";
import { deriveLog, formatTime } from "./deriveLog";
import type { MochaLogLine } from "../../state/store";

const line = (text: string, stream: "stdout" | "stderr" = "stdout"): MochaLogLine =>
    ({ text, stream, receivedAt: 0 });

describe("deriveLog", () => {
    it("classifies a tick as PASS and increments the step counter", () => {
        const out = deriveLog({
            log: [line("  ✓ navigates to login")],
            runStartedAt: null,
        });
        expect(out.rows).toHaveLength(1);
        expect(out.rows[0].level).toBe("PASS");
        expect(out.rows[0].step).toBe(1);
        expect(out.counts.passed).toBe(1);
        expect(out.counts.failed).toBe(0);
    });

    it("classifies a cross as FAIL and counts steps independently", () => {
        const out = deriveLog({
            log: [line("  ✓ ok"), line("  1) broken test")],
            runStartedAt: null,
        });
        expect(out.rows.map((r) => r.level)).toEqual(["PASS", "FAIL"]);
        expect(out.rows.map((r) => r.step)).toEqual([1, 2]);
        expect(out.counts.passed).toBe(1);
        expect(out.counts.failed).toBe(1);
        expect(out.counts.totalSteps).toBe(2);
    });

    it("treats stderr without 'Error:' as WARN", () => {
        const out = deriveLog({
            log: [line("ChromeDriver detached", "stderr")],
            runStartedAt: null,
        });
        expect(out.rows[0].level).toBe("WARN");
    });

    it("treats stderr 'Error:' lines as FAIL", () => {
        const out = deriveLog({
            log: [line("AssertionError: expected 1 to equal 2", "stderr")],
            runStartedAt: null,
        });
        expect(out.rows[0].level).toBe("FAIL");
    });

    it("treats [pre-run] prefixed lines as SYS", () => {
        const out = deriveLog({
            log: [line("[pre-run] npm run build")],
            runStartedAt: null,
        });
        expect(out.rows[0].level).toBe("SYS");
    });

    it("falls back to INFO for plain stdout", () => {
        const out = deriveLog({
            log: [line("Login Form")],
            runStartedAt: null,
        });
        expect(out.rows[0].level).toBe("INFO");
    });

    it("splits a multi-line payload into individual rows", () => {
        const out = deriveLog({
            log: [line("  ✓ first\n  ✓ second\n  1) broken")],
            runStartedAt: null,
        });
        expect(out.rows).toHaveLength(3);
        expect(out.rows.map((r) => r.level)).toEqual(["PASS", "PASS", "FAIL"]);
    });

    it("appends a synthetic FAIL row for currentFailure", () => {
        const out = deriveLog({
            log: [],
            runStartedAt: null,
            currentFailure: {
                test: "should click submit",
                file: "login.spec.js",
                error: "selector not found\n at line 12",
                stack: "",
            },
        });
        expect(out.rows).toHaveLength(1);
        expect(out.rows[0].level).toBe("FAIL");
        expect(out.rows[0].text).toContain("should click submit");
        expect(out.rows[0].text).toContain("selector not found");
    });

    it("appends a SELF-HEAL row when there's a pending diff", () => {
        const out = deriveLog({
            log: [],
            runStartedAt: null,
            pendingDiff: {
                reqId: "r1",
                file: "pages/login.page.js",
                oldCode: "button.submit-btn",
                newCode: "button[data-testid=\"login-submit\"]",
            },
        });
        const heal = out.rows[0];
        expect(heal.level).toBe("SELF-HEAL");
        expect(heal.heal?.oldCode).toBe("button.submit-btn");
        expect(heal.heal?.newCode).toBe("button[data-testid=\"login-submit\"]");
        expect(heal.heal?.filePath).toBe("pages/login.page.js");
    });

    it("uses receivedAt to compute relative timeMs when runStartedAt is set", () => {
        const startedAt = 1_700_000_000_000;
        const out = deriveLog({
            log: [{ stream: "stdout", text: "  ✓ ok", receivedAt: startedAt + 250 }],
            runStartedAt: startedAt,
        });
        expect(out.rows[0].timeMs).toBe(250);
    });

    it("returns timeMs=0 when runStartedAt is null", () => {
        const out = deriveLog({
            log: [{ stream: "stdout", text: "  ✓ ok", receivedAt: 1_700_000_000_000 }],
            runStartedAt: null,
        });
        expect(out.rows[0].timeMs).toBe(0);
    });

    it("skips empty / blank lines in the payload", () => {
        const out = deriveLog({
            log: [line("\n\n  ✓ only this\n\n")],
            runStartedAt: null,
        });
        expect(out.rows).toHaveLength(1);
        expect(out.rows[0].level).toBe("PASS");
    });
});

describe("formatTime", () => {
    it("formats sub-second values with leading zeros", () => {
        expect(formatTime(0)).toBe("00:00.000");
        expect(formatTime(42)).toBe("00:00.042");
    });

    it("formats minutes and seconds", () => {
        expect(formatTime(63_500)).toBe("01:03.500");
    });

    it("clamps negative values to zero", () => {
        expect(formatTime(-1)).toBe("00:00.000");
    });
});
