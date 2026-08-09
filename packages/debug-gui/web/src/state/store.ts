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
    // Wall-clock ms when the runner reported a `paused` event. Captured here
    // (not in deriveLog) so the synthetic FAIL row's TIME column is anchored
    // at the moment of pause, not the moment deriveLog last re-ran.
    pausedAt?: number;
}
export interface Diff {
    reqId: string;
    file: string;
    oldCode: string;
    newCode: string;
    // Wall-clock ms the diff event landed in the store. Same rationale as
    // Snapshot.pausedAt — keeps deriveLog pure of Date.now().
    receivedAt: number;
}
export interface Pick {
    reqId: string;
    hint: string;
}
export interface Prompt {
    reqId: string;
    summary: string;
    options: { id: string; label: string; detail?: string }[];
    allowFreeText: boolean;
}
export interface LspWarning {
    kind: "missing" | "broken" | "config-invalid" | "fs-error";
    message?: string;
    installCmd?: string;
    stderrTail?: string;
}

// Side-band INFO/WARN message surfaced in LogPanel. Currently driven by the
// server when an `edit_file` is approved during pause: Mocha's per-process
// require cache means the just-written fix won't take effect on the in-flight
// retry, so we tell QA to click Run again rather than Continue. Cleared on
// new run start (status → running from idle/done) and on user dismiss.
export interface Notice {
    kind: "info" | "warning" | "error";
    message: string;
}

export interface ServerEvent {
    type: string;
    [k: string]: any;
}

export interface MochaLogLine {
    stream: "stdout" | "stderr";
    text: string;
    // Wall-clock timestamp the line was added to the store. The LogPanel
    // converts this into a relative offset against `runStartedAt` for
    // display. We capture it here (rather than in deriveLog) so derivation
    // stays a pure function of state.
    receivedAt: number;
    // Monotonic per-line id, assigned at push time. Survives the buffer
    // slice(-500): deriveLog uses it as the React key so existing rows keep
    // their identity when older lines fall off the front of the buffer.
    seq: number;
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
    // Wall-clock ms when the run entered `running` (or `pre-running`).
    // Reset to null on idle/done so the elapsed timer in the LogPanel
    // freezes between runs.
    runStartedAt: number | null;
    agentThinking: boolean;
    agentActivity: string;
    lspWarning: LspWarning | null;
    dismissLspWarning: () => void;
    notice: Notice | null;
    dismissNotice: () => void;
    applyEvent: (e: ServerEvent) => void;
    // Switch the active spec/node selection.
    //
    //   * Same spec, same node → no-op.
    //
    //   * Anything else (spec changes, OR same spec / different node) →
    //     drop everything tied to the previous run: mochaLog,
    //     mochaExitCode, runStartedAt, currentFailure, currentSpec,
    //     pausedAt, chatMessages, agentThinking, agentActivity,
    //     pendingDiff, pendingPick, pendingPrompt. Session state itself
    //     resets to "idle" so the StatusHeader doesn't carry "DONE"
    //     onto a suite that hasn't been run yet. Whatever was on screen
    //     belonged to the prior (spec, grep) tuple; under the new
    //     selection it is stale.
    //
    // Why one rule covers both cases: every call site of selectSuite in
    // App.tsx is reached only when state is "idle"/"done" (or about to
    // be after a cancel). requestSelectionChange intercepts clicks
    // while isLive and routes them through the suite-switch dialog,
    // which sends {type:"cancel"} before this reducer runs. The
    // server's cancel handler aborts currentAgentSession and rejects
    // all in-flight edit/pick/ask resolvers with "session aborted", so
    // no agent code is still waiting on the chatMessages/pendingDiff/
    // pendingPick/pendingPrompt we drop here. The earlier same-spec
    // branch tried to preserve "agent-session" state for a re-grep
    // mid-conversation, but no UI path actually reaches selectSuite
    // mid-conversation — so the preservation only ever surfaced stale
    // chat after a paused run was switched away from.
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
    runStartedAt: null,
    agentThinking: false,
    agentActivity: "",
    lspWarning: null,
    dismissLspWarning: () => set({ lspWarning: null }),
    notice: null,
    dismissNotice: () => set({ notice: null }),
    applyEvent: (e) =>
        set((s) => {
            if (e.type === "init") {
                return {
                    suites: e.suites, config: e.config, state: e.state,
                    mochaLog: [], mochaExitCode: undefined,
                    runStartedAt: null,
                    agentThinking: false, agentActivity: "",
                    notice: null,
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
                    const wasLive =
                        s.state.state === "running" ||
                        s.state.state === "pre-running" ||
                        s.state.state === "paused";
                    if (wasLive) {
                        // Resume from paused, or pre-running→running on
                        // the same run. Don't wipe agent-session state —
                        // pendingDiff/Pick/Prompt and chatMessages may
                        // still belong to the in-flight session, and
                        // mochaLog/runStartedAt anchor the same run.
                        // currentFailure/pausedAt only describe the
                        // paused state we just left — drop them so the
                        // FailureCard and synthetic FAIL log row don't
                        // linger across Continue.
                        return { state: { state: e.state, currentSpec: s.state.currentSpec } };
                    }
                    // Fresh run starting from idle/done. The prior
                    // session's resolvers were either resolved by QA or
                    // rejected by the server's cancel handler, so the
                    // chat / pendingDiff / pendingPick / pendingPrompt
                    // we still hold are stale UI under the new run.
                    // Same scope as selectSuite when the (spec, grep)
                    // tuple changes — see the contract on Store.
                    return {
                        state: { state: e.state, currentSpec: s.state.currentSpec },
                        mochaLog: [], mochaExitCode: undefined,
                        runStartedAt: Date.now(),
                        agentThinking: false, agentActivity: "",
                        chatMessages: [],
                        pendingDiff: null,
                        pendingPick: null,
                        pendingPrompt: null,
                        notice: null,
                    };
                }
                // idle/done: drop currentFailure/pausedAt so a Stop click
                // while paused (or a natural finish landing on a paused
                // leaf) doesn't leave the FailureCard / synthetic FAIL
                // log row visible. `runStartedAt` is a top-level field
                // (not part of state), preserved across this transition
                // so deriveLog can still anchor row times for log lines
                // captured during the run; the next run resets the
                // anchor in the running branch above.
                return { state: { state: e.state, currentSpec: s.state.currentSpec } };
            }
            if (e.type === "paused") {
                return { state: { ...s.state, state: "paused", currentFailure: e.failure, pausedAt: Date.now() } };
            }
            if (e.type === "diff") {
                return { pendingDiff: { reqId: e.reqId, file: e.file, oldCode: e.oldCode, newCode: e.newCode, receivedAt: Date.now() } };
            }
            if (e.type === "pick") {
                return { pendingPick: { reqId: e.reqId, hint: e.hint } };
            }
            if (e.type === "pick_done") {
                if (s.pendingPick?.reqId === e.reqId) return { pendingPick: null };
                return {};
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
                const lastSeq = s.mochaLog.length > 0 ? s.mochaLog[s.mochaLog.length - 1].seq : 0;
                const next = [
                    ...s.mochaLog,
                    { stream: e.stream, text: e.text, receivedAt: Date.now(), seq: lastSeq + 1 },
                ];
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
            if (e.type === "lsp/warning") {
                return { lspWarning: e.warning as LspWarning };
            }
            if (e.type === "notice") {
                // Latest notice replaces the previous one (in case QA approved
                // a second edit before dismissing the first). Cleared on
                // dismissNotice() and on fresh-run status transitions above.
                const kind: Notice["kind"] =
                    e.kind === "warning" || e.kind === "error" ? e.kind : "info";
                return { notice: { kind, message: String(e.message ?? "") } };
            }
            return {};
        }),
    selectSuite: (spec, node) =>
        set((s) => {
            // Defensive: every call site in App.tsx already gates this on
            // !isLive, but a future caller could forget. Bail rather than
            // silently wipe a live agent session — the destructive scope
            // below includes chatMessages, pendingDiff, pendingPick,
            // pendingPrompt, which the agent code may still be awaiting.
            const live =
                s.state.state === "running" ||
                s.state.state === "pre-running" ||
                s.state.state === "paused";
            if (live) return {};
            const sameSpec = spec === s.selectedSpec;
            const sameNode =
                node?.kind === s.selectedNode?.kind &&
                node?.fullTitle === s.selectedNode?.fullTitle;
            if (sameSpec && sameNode) {
                // Idempotent click on the already-active row — no-op so we
                // don't gratuitously wipe state.
                return {};
            }
            // Any actual change to spec or node — everything tied to the
            // previous (spec, grep) tuple is now stale. See the contract
            // comment on the Store interface for why this also covers
            // agent-session state.
            return {
                selectedSpec: spec,
                selectedNode: node,
                mochaLog: [],
                mochaExitCode: undefined,
                runStartedAt: null,
                chatMessages: [],
                agentThinking: false,
                agentActivity: "",
                pendingDiff: null,
                pendingPick: null,
                pendingPrompt: null,
                notice: null,
                // Reset session state to idle so the StatusHeader doesn't
                // carry "DONE" onto a suite that hasn't been run yet. The
                // live-guard above already short-circuits running/paused,
                // so the only states that reach here are idle/done.
                state: { state: "idle" },
            };
        }),
}));
