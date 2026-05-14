import { STATE, type SessionState } from "./state.js";
import type { FailureInfo } from "./failure.js";
import type { ServerEvent } from "./events.js";
import type { ClientCommand } from "./commands.js";
import type { WorkerOutbound } from "./worker.js";

// Hand-written, allocation-free runtime guards for the wire surface.
// Each guard takes `unknown` and returns the typed DU variant on a
// successful duck-type check, or `null` on any mismatch. The callers
// (WS receiver, server's handleIncoming, WorkerLink.attach) check the
// return value and log + drop on null — never throw, never trust.
//
// Design notes:
//   * Duck-type required fields only. Extra fields pass through
//     (the cjs worker hook emits `attempt`/`maxAttempts`/`duration`
//     on FailureInfo that aren't strictly required, and we don't
//     want to drop those frames).
//   * No Zod or other runtime-schema lib — minor perf + zero deps.
//   * Type-only narrowing inside; the cast at the end is the
//     boundary contract.

function isObj(x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === "object";
}

function isString(x: unknown): x is string {
    return typeof x === "string";
}

function isNumber(x: unknown): x is number {
    return typeof x === "number";
}

function isBoolean(x: unknown): x is boolean {
    return typeof x === "boolean";
}

function isFailureInfo(x: unknown): x is FailureInfo {
    if (!isObj(x)) return false;
    if (!isString(x.test)) return false;
    if (!isString(x.file)) return false;
    if (!isString(x.error)) return false;
    if (!isString(x.stack)) return false;
    // suite / pausedAt / attempt / maxAttempts / duration optional — extras pass through.
    return true;
}

function isSessionState(x: unknown): x is SessionState {
    return (
        x === STATE.IDLE ||
        x === STATE.PRE_RUNNING ||
        x === STATE.RUNNING ||
        x === STATE.PAUSED ||
        x === STATE.DONE
    );
}

// ── WorkerOutbound (Worker → Server IPC frames) ──────────────────────

export function parseWorkerFrame(m: unknown): WorkerOutbound | null {
    if (!isObj(m)) return null;
    if (m.type === "status") {
        if (m.state !== STATE.RUNNING && m.state !== STATE.DONE) return null;
        return m as unknown as WorkerOutbound;
    }
    if (m.type === "paused") {
        if (!isFailureInfo(m.failure)) return null;
        return m as unknown as WorkerOutbound;
    }
    if (m.type === "done") {
        if (!isNumber(m.failures)) return null;
        return m as unknown as WorkerOutbound;
    }
    return null;
}

// ── ClientCommand (Web → Server WS frames) ───────────────────────────

export function parseClientCommand(m: unknown): ClientCommand | null {
    if (!isObj(m)) return null;
    switch (m.type) {
        case "run":
            if (!isString(m.spec)) return null;
            // skipPreRun / grep / bailOnFailure all optional.
            return m as unknown as ClientCommand;
        case "cancel":
        case "continue":
        case "agent_abort":
            return m as unknown as ClientCommand;
        case "chat_send":
            if (!isString(m.prompt)) return null;
            return m as unknown as ClientCommand;
        case "diff_decision":
            if (!isString(m.reqId)) return null;
            if (m.action !== "approved" && m.action !== "rejected") return null;
            return m as unknown as ClientCommand;
        case "pick_cancel":
            if (!isString(m.reqId)) return null;
            return m as unknown as ClientCommand;
        case "prompt_response":
            if (!isString(m.reqId)) return null;
            // choice and freeText are nullable strings — accept null or string.
            if (m.choice !== null && !isString(m.choice)) return null;
            if (m.freeText !== null && !isString(m.freeText)) return null;
            return m as unknown as ClientCommand;
        case "settings_update":
            // Pass the envelope through unchecked at the parse layer; the
            // dispatcher's handleSettingsUpdate owns field validation +
            // user-facing error broadcasts (the contract the existing
            // ws.test.ts pins). If we rejected bad fields here, callers
            // would lose the "Save settings: preRun must be a string"
            // surfacing path.
            return m as unknown as ClientCommand;
        default:
            return null;
    }
}

// ── ServerEvent (Server → Web WS frames) ─────────────────────────────

export function parseServerEvent(m: unknown): ServerEvent | null {
    if (!isObj(m)) return null;
    switch (m.type) {
        case "init":
            if (!isObj(m.state) || !isSessionState(m.state.state)) return null;
            if (!Array.isArray(m.suites)) return null;
            return m as unknown as ServerEvent;
        case "status":
            if (!isSessionState(m.state)) return null;
            return m as unknown as ServerEvent;
        case "paused":
            if (!isFailureInfo(m.failure)) return null;
            return m as unknown as ServerEvent;
        case "test_progress":
            if (!isString(m.test)) return null;
            if (m.result !== "pass" && m.result !== "fail" && m.result !== "pending") return null;
            return m as unknown as ServerEvent;
        case "mocha_log":
            if (m.stream !== "stdout" && m.stream !== "stderr") return null;
            if (!isString(m.text)) return null;
            return m as unknown as ServerEvent;
        case "mocha_exit":
            if (m.code !== null && !isNumber(m.code)) return null;
            return m as unknown as ServerEvent;
        case "agent_thinking":
            if (!isBoolean(m.active)) return null;
            return m as unknown as ServerEvent;
        case "agent_activity":
            if (!isString(m.label)) return null;
            return m as unknown as ServerEvent;
        case "chat_delta":
            if (!isString(m.text)) return null;
            return m as unknown as ServerEvent;
        case "chat_final":
            if (!isString(m.content)) return null;
            return m as unknown as ServerEvent;
        case "diff":
            if (!isString(m.reqId) || !isString(m.file) || !isString(m.oldCode) || !isString(m.newCode)) {
                return null;
            }
            return m as unknown as ServerEvent;
        case "pick":
            if (!isString(m.reqId) || !isString(m.hint)) return null;
            return m as unknown as ServerEvent;
        case "pick_done":
            if (!isString(m.reqId)) return null;
            return m as unknown as ServerEvent;
        case "prompt":
            if (!isString(m.reqId)) return null;
            if (!isString(m.summary)) return null;
            if (!Array.isArray(m.options)) return null;
            if (!isBoolean(m.allowFreeText)) return null;
            return m as unknown as ServerEvent;
        case "prompt_done":
            if (!isString(m.reqId)) return null;
            return m as unknown as ServerEvent;
        case "config_updated":
            // config is opaque to the reducer.
            return m as unknown as ServerEvent;
        case "suites_updated":
            if (!Array.isArray(m.suites)) return null;
            return m as unknown as ServerEvent;
        case "lsp/warning":
            if (!isObj(m.warning)) return null;
            return m as unknown as ServerEvent;
        case "notice":
            if (m.kind !== "info" && m.kind !== "warning" && m.kind !== "error") return null;
            if (!isString(m.message)) return null;
            return m as unknown as ServerEvent;
        case "error":
            if (!isString(m.message)) return null;
            return m as unknown as ServerEvent;
        default:
            return null;
    }
}
