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
export interface Prompt {
    reqId: string;
    summary: string;
    options: { id: string; label: string; detail?: string }[];
    allowFreeText: boolean;
}

export interface ServerEvent {
    type: string;
    [k: string]: any;
}

export interface MochaLogLine {
    stream: "stdout" | "stderr";
    text: string;
}

// Selected describe/it inside the active spec. `null` means "run the whole
// spec file" (no --grep). The kind drives how the UI builds the Mocha
// --grep regex (see lib/mochaGrep).
export interface SelectedNode {
    kind: "describe" | "it";
    fullTitle: string;
}

// Mirror of server/src/parseSuite.ts shapes — duplicated so the web bundle
// has no compile-time dep on the server's emitted types.
export interface SuiteNode {
    kind: "describe" | "it";
    title: string;
    fullTitle: string;
    line: number;
    endLine: number;
    children: SuiteNode[];
    pending?: boolean;
    only?: boolean;
}
export interface SuiteTree {
    file: string;
    relPath: string;
    children: SuiteNode[];
    source?: string;
    error?: string;
}

interface Store {
    suites: Suite[];
    config: Record<string, unknown>;
    state: Snapshot;
    selectedSpec: string | null;
    selectedNode: SelectedNode | null;
    // Cached parsed trees keyed by spec relPath. Populated by TestTree after
    // a successful /api/suite/tree fetch so other components (e.g.
    // SelectionPanel, CodePreview) can read the source/line ranges without
    // refetching.
    suiteTrees: Record<string, SuiteTree>;
    chatMessages: Array<{ role: "assistant" | "user"; content: string }>;
    pendingDiff: Diff | null;
    pendingPick: Pick | null;
    pendingPrompt: Prompt | null;
    mochaLog: MochaLogLine[];
    mochaExitCode: number | null | undefined;
    agentThinking: boolean;
    agentActivity: string;
    applyEvent: (e: ServerEvent) => void;
    // Switch the active spec/node selection. When the spec actually changes,
    // run-output that belongs to the previous spec (mocha log, failure card,
    // chat history, agent prompts) is dropped so the UI never shows stale
    // data from a different file. When only the node changes within the
    // same spec, the run-output is preserved.
    selectSuite: (spec: string | null, node: SelectedNode | null) => void;
}

export const useStore = create<Store>((set) => ({
    suites: [],
    config: {},
    state: { state: "idle" },
    selectedSpec: null,
    selectedNode: null,
    suiteTrees: {},
    chatMessages: [],
    pendingDiff: null,
    pendingPick: null,
    pendingPrompt: null,
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
                // Drop cached trees for specs that no longer exist — they'd
                // render under file rows that have been removed from discovery.
                const validSpecs = new Set(next.map((suite) => suite.relPath));
                const trimmedTrees: Record<string, SuiteTree> = {};
                for (const [k, v] of Object.entries(s.suiteTrees)) {
                    if (validSpecs.has(k)) trimmedTrees[k] = v;
                }
                return {
                    suites: next,
                    selectedSpec: stillThere ? s.selectedSpec : null,
                    selectedNode: stillThere ? s.selectedNode : null,
                    suiteTrees: trimmedTrees,
                };
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
            if (e.type === "prompt") {
                return {
                    pendingPrompt: {
                        reqId: e.reqId,
                        summary: e.summary,
                        options: e.options,
                        allowFreeText: e.allowFreeText,
                    },
                };
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
    selectSuite: (spec, node) =>
        set((s) => {
            const sameSpec = spec === s.selectedSpec;
            const sameNode =
                node?.kind === s.selectedNode?.kind &&
                node?.fullTitle === s.selectedNode?.fullTitle;
            if (sameSpec && sameNode) {
                // Idempotent click on the already-active row — no-op so we
                // don't gratuitously wipe state.
                return {};
            }
            // Selection actually changed (different spec OR different node
            // within the same spec). Run-output is tied to the prior
            // (spec, grep) tuple, so showing it under a different selection
            // is misleading — drop it.
            return {
                selectedSpec: spec,
                selectedNode: node,
                mochaLog: [],
                mochaExitCode: undefined,
                chatMessages: [],
                agentThinking: false,
                agentActivity: "",
                pendingDiff: null,
                pendingPick: null,
                pendingPrompt: null,
                state: { state: s.state.state },
            };
        }),
}));
