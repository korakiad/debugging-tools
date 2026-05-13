import type { FailureInfo } from "./failure.js";
import type { SessionSnapshot } from "./snapshot.js";

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
    | { type: "prompt_done"; reqId: string }
    | { type: "config_updated"; config: unknown }
    | { type: "suites_updated"; suites: unknown[] }
    | { type: "lsp/warning"; warning: LspWarning }
    | { type: "notice"; kind: "info" | "warning" | "error"; message: string }
    | { type: "error"; message: string };
