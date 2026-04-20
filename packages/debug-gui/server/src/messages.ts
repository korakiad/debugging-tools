import type { FailureInfo, SessionSnapshot } from "./session.js";

export type ServerEvent =
    | { type: "init"; suites: unknown[]; config: unknown; state: SessionSnapshot }
    | { type: "status"; state: SessionSnapshot["state"] }
    | { type: "paused"; failure: FailureInfo }
    | { type: "test_progress"; test: string; result: "pass" | "fail" | "pending" }
    | { type: "mocha_log"; stream: "stdout" | "stderr"; text: string }
    | { type: "mocha_exit"; code: number | null }
    | { type: "chat_delta"; text: string }
    | { type: "chat_final"; content: string }
    | { type: "diff"; reqId: string; file: string; oldCode: string; newCode: string }
    | { type: "pick"; reqId: string; imageUrl: string; hint: string }
    | { type: "error"; message: string };

export type ClientCommand =
    | { type: "run"; spec: string }
    | { type: "cancel" }
    | { type: "chat_send"; prompt: string }
    | { type: "diff_decision"; reqId: string; action: "approved" | "rejected"; reason?: string }
    | { type: "pick_result"; reqId: string; selector: string; attrs: Record<string, unknown> };
