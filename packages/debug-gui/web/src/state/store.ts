import { create } from "zustand";

export type SessionState = "idle" | "pre-running" | "running" | "paused" | "done";

export interface Suite {
    relPath: string;
    absPath: string;
}
export interface Failure {
    test: string;
    file: string;
    error: string;
    stack: string;
}
export interface Snapshot {
    state: SessionState;
    currentSpec?: string;
    currentFailure?: Failure;
}
export interface Diff {
    reqId: string;
    file: string;
    oldCode: string;
    newCode: string;
}
export interface Pick {
    reqId: string;
    imageUrl: string;
    hint: string;
}

export interface ServerEvent {
    type: string;
    [k: string]: any;
}

export interface MochaLogLine {
    stream: "stdout" | "stderr";
    text: string;
}

interface Store {
    suites: Suite[];
    config: Record<string, unknown>;
    state: Snapshot;
    selectedSpec: string | null;
    chatMessages: Array<{ role: "assistant" | "user"; content: string }>;
    pendingDiff: Diff | null;
    pendingPick: Pick | null;
    mochaLog: MochaLogLine[];
    mochaExitCode: number | null | undefined;
    agentThinking: boolean;
    agentActivity: string;
    applyEvent: (e: ServerEvent) => void;
}

export const useStore = create<Store>((set) => ({
    suites: [],
    config: {},
    state: { state: "idle" },
    selectedSpec: null,
    chatMessages: [],
    pendingDiff: null,
    pendingPick: null,
    mochaLog: [],
    mochaExitCode: undefined,
    agentThinking: false,
    agentActivity: "",
    applyEvent: (e) =>
        set((s) => {
            if (e.type === "init") {
                return {
                    suites: e.suites, config: e.config, state: e.state,
                    mochaLog: [], mochaExitCode: undefined,
                    agentThinking: false, agentActivity: "",
                };
            }
            if (e.type === "config_updated") {
                return { config: e.config };
            }
            if (e.type === "suites_updated") {
                const next: Suite[] = e.suites;
                const stillThere = !!s.selectedSpec && next.some((suite) => suite.relPath === s.selectedSpec);
                return { suites: next, selectedSpec: stillThere ? s.selectedSpec : null };
            }
            if (e.type === "status") {
                if (e.state === "running" || e.state === "pre-running") {
                    return {
                        state: { ...s.state, state: e.state },
                        mochaLog: [], mochaExitCode: undefined,
                        agentThinking: false, agentActivity: "",
                    };
                }
                return { state: { ...s.state, state: e.state } };
            }
            if (e.type === "paused") {
                return { state: { ...s.state, state: "paused", currentFailure: e.failure } };
            }
            if (e.type === "diff") {
                return { pendingDiff: { reqId: e.reqId, file: e.file, oldCode: e.oldCode, newCode: e.newCode } };
            }
            if (e.type === "pick") {
                return { pendingPick: { reqId: e.reqId, imageUrl: e.imageUrl, hint: e.hint } };
            }
            if (e.type === "mocha_log") {
                const next = [...s.mochaLog, { stream: e.stream, text: e.text }];
                return { mochaLog: next.slice(-500) };
            }
            if (e.type === "mocha_exit") {
                return { mochaExitCode: e.code };
            }
            if (e.type === "chat_delta") {
                const last = s.chatMessages[s.chatMessages.length - 1];
                if (last?.role === "assistant") {
                    return {
                        chatMessages: [...s.chatMessages.slice(0, -1), { ...last, content: last.content + e.text }],
                    };
                }
                return {
                    chatMessages: [...s.chatMessages, { role: "assistant", content: e.text }],
                };
            }
            if (e.type === "chat_final") {
                return { chatMessages: [...s.chatMessages, { role: "assistant", content: e.content }] };
            }
            if (e.type === "agent_thinking") {
                return { agentThinking: e.active, agentActivity: e.active ? s.agentActivity : "" };
            }
            if (e.type === "agent_activity") {
                return { agentActivity: e.label };
            }
            if (e.type === "error") {
                return {
                    chatMessages: [
                        ...s.chatMessages,
                        { role: "assistant", content: `[error] ${e.message}` },
                    ],
                };
            }
            return {};
        }),
}));
