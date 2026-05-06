import type { FailureInfo, SessionSnapshot } from "./session.js";

export interface LspWarning {
    kind: "missing" | "broken" | "config-invalid" | "fs-error";
    message?: string;
    installCmd?: string;
    stderrTail?: string;
}

export type ServerEvent =
    | { type: "init"; suites: unknown[]; config: unknown; state: SessionSnapshot }
    | { type: "status"; state: SessionSnapshot["state"] }
    | { type: "paused"; failure: FailureInfo }
    | { type: "test_progress"; test: string; result: "pass" | "fail" | "pending" }
    | { type: "mocha_log"; stream: "stdout" | "stderr"; text: string }
    | { type: "mocha_exit"; code: number | null }
    | { type: "agent_thinking"; active: boolean }
    | { type: "agent_activity"; label: string }
    | { type: "chat_delta"; text: string }
    | { type: "chat_final"; content: string }
    | { type: "diff"; reqId: string; file: string; oldCode: string; newCode: string }
    | { type: "pick"; reqId: string; hint: string }
    | { type: "pick_done"; reqId: string }
    | {
        type: "prompt";
        reqId: string;
        summary: string;
        options: { id: string; label: string; detail?: string }[];
        allowFreeText: boolean;
    }
    | { type: "config_updated"; config: unknown }
    | { type: "suites_updated"; suites: unknown[] }
    | { type: "lsp/warning"; warning: LspWarning }
    // Side-band INFO/WARN/ERROR surfaced in the UI's LogPanel notice slot.
    // Currently emitted when an `edit_file` is approved during pause: the
    // fix is now on disk but Mocha's per-process require cache means an
    // in-flight retry will hit the same error, so we tell QA to click Run.
    | { type: "notice"; kind: "info" | "warning" | "error"; message: string }
    | { type: "error"; message: string };

export type ClientCommand =
    | {
        type: "run";
        spec: string;
        skipPreRun?: boolean;
        // Mocha --grep regex source. Omit to run the whole file. The UI
        // builds this from the user's selection in TestTree (a single it
        // node → "^<full title>$", a describe → "^<full title> ").
        grep?: string;
        // Step-style suites: skip remaining tests (and disable retries)
        // once any test fails. Toolbar checkbox; not persisted across
        // sessions because it changes the whole-suite contract.
        bailOnFailure?: boolean;
    }
    | { type: "cancel" }
    | { type: "continue" }
    | { type: "chat_send"; prompt: string }
    | { type: "agent_abort" }
    | { type: "diff_decision"; reqId: string; action: "approved" | "rejected"; reason?: string }
    | { type: "pick_cancel"; reqId: string }
    | {
        type: "prompt_response";
        reqId: string;
        choice: string | null;
        freeText: string | null;
    }
    | {
        type: "settings_update";
        preRun?: string;
        idleTimeoutMs?: number;
        mode?: "auto" | "manual";
        discovery?: { globs?: string[]; exclude?: string[]; extensions?: string[] };
    };
