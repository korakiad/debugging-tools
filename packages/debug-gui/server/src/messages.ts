import type { FailureInfo, SessionSnapshot } from "./session.js";

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
    | { type: "pick"; reqId: string; imageUrl: string; hint: string }
    | { type: "config_updated"; config: unknown }
    | { type: "suites_updated"; suites: unknown[] }
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
    }
    | { type: "cancel" }
    | { type: "continue" }
    | { type: "chat_send"; prompt: string }
    | { type: "agent_abort" }
    | { type: "diff_decision"; reqId: string; action: "approved" | "rejected"; reason?: string }
    | { type: "pick_result"; reqId: string; selector: string; attrs: Record<string, unknown> }
    | {
        type: "settings_update";
        preRun?: string;
        idleTimeoutMs?: number;
        discovery?: { globs?: string[]; exclude?: string[]; extensions?: string[] };
    };
