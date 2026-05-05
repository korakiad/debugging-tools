// Pure projection from store events to structured log rows. Kept free of
// React imports so it can be unit-tested without RTL.
//
// We parse `mochaLog` text on the client because the server today emits
// only raw stdout/stderr (no `test_progress` events). Once the runtime hook
// starts emitting structured progress, this file can be replaced without
// touching the renderer.

import type { Failure, MochaLogLine } from "../../state/store";

export type LogLevel = "SYS" | "INFO" | "PASS" | "FAIL" | "WARN" | "SELF-HEAL";

export interface HealMeta {
    strategy: string;
    confidence?: number;
    durationMs?: number;
    oldCode: string;
    newCode: string;
    filePath?: string;
}

export interface LogRow {
    id: string;
    timeMs: number; // ms since runStartedAt; 0 when no clock
    level: LogLevel;
    step: number | null;
    text: string;
    heal?: HealMeta;
}

export interface DeriveInputs {
    log: MochaLogLine[];
    runStartedAt: number | null;
    currentFailure?: Failure;
    pendingDiff?: { reqId: string; file: string; oldCode: string; newCode: string } | null;
}

export interface DeriveOutputs {
    rows: LogRow[];
    counts: {
        passed: number;
        failed: number;
        // total is "rows seen so far that count as a step" — pass + fail.
        // Honest given we don't know the plan ahead of execution.
        totalSteps: number;
    };
}

// Synthetic rows (currentFailure, pendingDiff) have no `receivedAt` and
// fall back to `Date.now()`. Caller invokes deriveLog inside a useMemo
// keyed on those exact inputs, so the timestamp re-anchors only when
// the failure/diff itself changes — not on every re-render. A
// `mocha_log` arriving while paused will retroactively bump the
// synthetic row's TIME column; acceptable for v1 since structured
// `test_progress` events (with their own timestamps) will replace this
// path.
function relativeTime(receivedAt: number | undefined, startedAt: number): number {
    if (startedAt <= 0) return 0;
    if (receivedAt == null) return Math.max(0, Date.now() - startedAt);
    return Math.max(0, receivedAt - startedAt);
}

const TICK_RX = /^\s*[✓✔]\s+(.+?)(?:\s*\((\d+)ms\))?\s*$/;
const CROSS_RX = /^\s*(?:[✗✘]|\d+\))\s+(.+?)\s*$/;
const SUMMARY_RX = /^\s*\d+\s+(passing|failing|pending)\b/;
const ERROR_RX = /\b(?:Error|TypeError|RangeError|AssertionError):/;
const PRERUN_PREFIX = "[pre-run]";

function classify(line: { stream: MochaLogLine["stream"]; text: string }): { level: LogLevel; text: string } {
    const text = line.text.replace(/\s+$/, ""); // trim trailing newline only
    if (text.startsWith(PRERUN_PREFIX)) {
        return { level: "SYS", text };
    }
    if (TICK_RX.test(text)) return { level: "PASS", text };
    if (CROSS_RX.test(text)) return { level: "FAIL", text };
    if (SUMMARY_RX.test(text)) return { level: "SYS", text };
    if (line.stream === "stderr") {
        return { level: ERROR_RX.test(text) ? "FAIL" : "WARN", text };
    }
    return { level: "INFO", text };
}

// Split a single mocha_log payload (which may contain multiple newlines)
// into the individual classifiable parts the table renders. We keep blank
// lines out so the table doesn't show empty rows for terminal padding.
// `receivedAt` is dropped here because every chunk inherits its parent
// line's wall-clock timestamp.
type SplitPart = { stream: MochaLogLine["stream"]; text: string };

function splitLines(line: MochaLogLine): SplitPart[] {
    return line.text
        .split(/\r?\n/)
        .filter((part) => part.length > 0)
        .map((part) => ({ stream: line.stream, text: part }));
}

export function deriveLog(inputs: DeriveInputs): DeriveOutputs {
    const startedAt = inputs.runStartedAt ?? 0;
    const rows: LogRow[] = [];
    let step = 0;
    let passed = 0;
    let failed = 0;

    inputs.log.forEach((logLine, index) => {
        const lines = splitLines(logLine);
        const lineTime = relativeTime(logLine.receivedAt, startedAt);
        lines.forEach((line, subIndex) => {
            const { level, text } = classify(line);
            if (text.length === 0) return;
            let rowStep: number | null = null;
            if (level === "PASS") {
                step += 1;
                passed += 1;
                rowStep = step;
            } else if (level === "FAIL") {
                step += 1;
                failed += 1;
                rowStep = step;
            }
            rows.push({
                id: `m:${index}:${subIndex}`,
                timeMs: lineTime,
                level,
                step: rowStep,
                text,
            });
        });
    });

    if (inputs.currentFailure) {
        const failText = `${inputs.currentFailure.test} — ${inputs.currentFailure.error.split("\n")[0]}`;
        rows.push({
            id: `failure:${inputs.currentFailure.test}`,
            timeMs: relativeTime(undefined, startedAt),
            level: "FAIL",
            step: null,
            text: failText,
        });
    }

    if (inputs.pendingDiff) {
        rows.push({
            id: `heal:${inputs.pendingDiff.reqId}`,
            timeMs: relativeTime(undefined, startedAt),
            level: "SELF-HEAL",
            step: null,
            text: "agent proposed selector self-heal",
            heal: {
                strategy: "agent fix",
                oldCode: inputs.pendingDiff.oldCode,
                newCode: inputs.pendingDiff.newCode,
                filePath: inputs.pendingDiff.file,
            },
        });
    }

    return {
        rows,
        counts: { passed, failed, totalSteps: passed + failed },
    };
}

export function formatTime(timeMs: number): string {
    const total = Math.max(0, Math.floor(timeMs));
    const ms = total % 1000;
    const sec = Math.floor(total / 1000) % 60;
    const min = Math.floor(total / 60000);
    const mm = String(min).padStart(2, "0");
    const ss = String(sec).padStart(2, "0");
    const mmm = String(ms).padStart(3, "0");
    return `${mm}:${ss}.${mmm}`;
}
