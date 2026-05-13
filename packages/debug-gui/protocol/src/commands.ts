export type ClientCommand =
    | {
        type: "run";
        spec: string;
        skipPreRun?: boolean;
        grep?: string;
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
