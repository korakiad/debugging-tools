import { create } from "zustand";
import {
    STATE,
    isLive,
    assertNever,
    type SessionState,
    type SessionSnapshot,
    type FailureInfo,
    type ServerEvent,
    type LspWarning,
    type SuiteNode,
    type SuiteTree,
} from "@debug-gui/protocol";

export type { SessionState, SessionSnapshot, FailureInfo, ServerEvent, LspWarning, SuiteNode, SuiteTree };

// Back-compat aliases used elsewhere in the web bundle. Phase 0c keeps
// these so component imports don't churn; remove in a later phase if
// nothing depends on the short names.
export type Failure = FailureInfo;
export type Snapshot = SessionSnapshot;

export interface Suite {
    relPath: string;
    absPath: string;
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

// Side-band INFO/WARN message surfaced in LogPanel. Currently driven by the
// server when an `edit_file` is approved during pause: a reminder to click
// Continue, which re-forks the worker so the fix lands in a fresh require
// cache. Cleared on new run start (status → running from idle/done) and on
// user dismiss.
export interface Notice {
    kind: "info" | "warning" | "error";
    message: string;
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

interface Store {
    suites: Suite[];
    config: Record<string, unknown>;
    state: SessionSnapshot;
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
    // Accepts ServerEvent strictly. Phase 6 will parse + validate at the
    // WS boundary (useWebSocket); for now, useWebSocket casts JSON.parse
    // result to ServerEvent before invoking.
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
    state: { state: STATE.IDLE },
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
            switch (e.type) {
                case "init":
                    return {
                        suites: e.suites as Suite[],
                        config: e.config as Record<string, unknown>,
                        state: e.state,
                        mochaLog: [], mochaExitCode: undefined,
                        runStartedAt: null,
                        agentThinking: false, agentActivity: "",
                        notice: null,
                    };
                case "config_updated":
                    return { config: e.config as Record<string, unknown> };
                case "suites_updated": {
                    const next = e.suites as Suite[];
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
                case "status": {
                    if (e.state === STATE.RUNNING || e.state === STATE.PRE_RUNNING) {
                        // The wire `status` event carries no spec — currentSpec
                        // is mirrored from the prior snapshot (set by `init`
                        // or by a server-side spec context that landed before
                        // the status broadcast). Pass it through unchanged;
                        // PreRunning/Running.currentSpec is optional in the DU.
                        const currentSpec = s.state.currentSpec;
                        const nextSnap: SessionSnapshot =
                            e.state === STATE.RUNNING
                                ? { state: STATE.RUNNING, currentSpec }
                                : { state: STATE.PRE_RUNNING, currentSpec };
                        if (isLive(s.state.state)) {
                            // Resume from paused, or pre-running→running on
                            // the same run. Don't wipe agent-session state —
                            // pendingDiff/Pick/Prompt and chatMessages may
                            // still belong to the in-flight session, and
                            // mochaLog/runStartedAt anchor the same run.
                            // currentFailure/pausedAt only describe the
                            // paused state we just left — drop them so the
                            // FailureCard and synthetic FAIL log row don't
                            // linger across Continue.
                            return { state: nextSnap };
                        }
                        // Fresh run starting from idle/done. The prior
                        // session's resolvers were either resolved by QA or
                        // rejected by the server's cancel handler, so the
                        // chat / pendingDiff / pendingPick / pendingPrompt
                        // we still hold are stale UI under the new run.
                        // Same scope as selectSuite when the (spec, grep)
                        // tuple changes — see the contract on Store.
                        return {
                            state: nextSnap,
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
                    const nextSnap: SessionSnapshot =
                        e.state === STATE.IDLE
                            ? { state: STATE.IDLE, currentSpec: s.state.currentSpec }
                            : { state: STATE.DONE, currentSpec: s.state.currentSpec };
                    return { state: nextSnap };
                }
                case "paused": {
                    // PausedSnapshot requires currentSpec. Real flow: server's
                    // markRunning(spec) sets it before any markPaused can fire,
                    // so the prior snapshot usually has it. Fallback to
                    // failure.file (the spec path the worker just paused in)
                    // when the wire `status` events haven't seeded currentSpec
                    // — those events carry no spec, so a cold start from
                    // idle would otherwise drop the paused event.
                    const failure = e.failure;
                    const currentSpec = s.state.currentSpec ?? failure.file;
                    return {
                        state: {
                            state: STATE.PAUSED,
                            currentSpec,
                            currentFailure: failure,
                            pausedAt: failure.pausedAt ?? Date.now(),
                        },
                    };
                }
                case "diff":
                    return { pendingDiff: { reqId: e.reqId, file: e.file, oldCode: e.oldCode, newCode: e.newCode, receivedAt: Date.now() } };
                case "pick":
                    return { pendingPick: { reqId: e.reqId, hint: e.hint } };
                case "pick_done":
                    if (s.pendingPick?.reqId === e.reqId) return { pendingPick: null };
                    return {};
                case "prompt":
                    return {
                        pendingPrompt: {
                            reqId: e.reqId,
                            summary: e.summary,
                            options: e.options,
                            allowFreeText: e.allowFreeText,
                        },
                    };
                // Symmetric to pick_done. Server emits this when the underlying
                // ask_user resolver is rejected (Stop / Cancel / Continue) so
                // the prompt panel doesn't stick after the agent's tool call
                // is gone.
                case "prompt_done":
                    if (s.pendingPrompt?.reqId === e.reqId) return { pendingPrompt: null };
                    return {};
                case "mocha_log": {
                    const lastSeq = s.mochaLog.length > 0 ? s.mochaLog[s.mochaLog.length - 1].seq : 0;
                    const next = [
                        ...s.mochaLog,
                        { stream: e.stream, text: e.text, receivedAt: Date.now(), seq: lastSeq + 1 },
                    ];
                    return { mochaLog: next.slice(-500) };
                }
                case "mocha_exit":
                    return { mochaExitCode: e.code };
                case "chat_delta": {
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
                case "chat_final":
                    return { chatMessages: [...s.chatMessages, { role: "assistant", content: e.content }] };
                case "agent_thinking":
                    return { agentThinking: e.active, agentActivity: e.active ? s.agentActivity : "" };
                case "agent_activity":
                    return { agentActivity: e.label };
                case "error":
                    return {
                        chatMessages: [
                            ...s.chatMessages,
                            { role: "assistant", content: `[error] ${e.message}` },
                        ],
                    };
                case "lsp/warning":
                    return { lspWarning: e.warning };
                case "notice": {
                    // Latest notice replaces the previous one (in case QA approved
                    // a second edit before dismissing the first). Cleared on
                    // dismissNotice() and on fresh-run status transitions above.
                    const kind: Notice["kind"] =
                        e.kind === "warning" || e.kind === "error" ? e.kind : "info";
                    return { notice: { kind, message: String(e.message ?? "") } };
                }
                case "test_progress":
                    // Reserved for future per-test progress UI; currently
                    // emitted-but-ignored at the store layer.
                    return {};
                default:
                    return assertNever(e, "useStore.applyEvent");
            }
        }),
    selectSuite: (spec, node) =>
        set((s) => {
            // Defensive: every call site in App.tsx already gates this on
            // !isLive, but a future caller could forget. Bail rather than
            // silently wipe a live agent session — the destructive scope
            // below includes chatMessages, pendingDiff, pendingPick,
            // pendingPrompt, which the agent code may still be awaiting.
            if (isLive(s.state.state)) return {};
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
                state: { state: STATE.IDLE },
            };
        }),
}));
