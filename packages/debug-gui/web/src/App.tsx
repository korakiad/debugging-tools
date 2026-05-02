import { useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useStore } from "./state/store";
import { TestTree, type TestSelection } from "./components/TestTree";
import { EfDialog } from "./ui/EfDialog";
import { SelectionPanel } from "./components/SelectionPanel";
import { CodePreview, languageFromPath, sliceSource } from "./components/CodePreview";
import { mochaGrepFor } from "./lib/mochaGrep";
import { findNode } from "./lib/findNode";
import { FailureCard } from "./components/FailureCard";
import { DiffView } from "./components/DiffView";
import { PickerOverlay } from "./components/PickerOverlay";
import { ModeToggle, type AgentMode } from "./components/ModeToggle";
import { ChatDrawer } from "./components/ChatDrawer";
import { MochaLogPanel } from "./components/MochaLogPanel";
import { Spinner } from "./components/Spinner";
import { PreRunRow } from "./components/PreRunRow";
import { SettingsDialog, type DebugGuiConfigShape } from "./components/SettingsDialog";
import { EfButton } from "./ui";

export default function App() {
    const { send } = useWebSocket();
    const suites = useStore((s) => s.suites);
    const state = useStore((s) => s.state);
    const selectedSpec = useStore((s) => s.selectedSpec);
    const selectedNode = useStore((s) => s.selectedNode);
    const suiteTrees = useStore((s) => s.suiteTrees);
    const selection: TestSelection | null = selectedSpec ? { spec: selectedSpec, node: selectedNode } : null;

    // Code preview for the active selection. We slice the cached file source
    // using the node's [line, endLine] so the QA operator sees exactly the
    // describe/it body that --grep will run.
    const tree = selectedSpec ? suiteTrees[selectedSpec] : undefined;
    const matchedNode = findNode(tree, selectedNode);
    const previewCode = matchedNode ? sliceSource(tree?.source, matchedNode.line, matchedNode.endLine) : null;
    const diff = useStore((s) => s.pendingDiff);
    const pick = useStore((s) => s.pendingPick);
    const prompt = useStore((s) => s.pendingPrompt);
    const config = useStore((s) => s.config) as { preRun?: string; agent?: { mode?: AgentMode } } & DebugGuiConfigShape;
    const savedPreRun = config.preRun ?? "";
    const mode: AgentMode = config.agent?.mode === "manual" ? "manual" : "auto";
    // Skip defaults to unchecked on every reload. Persisting it would let a
    // user accidentally skip builds session after session; the design calls
    // out "always run build" as the safe default.
    const [skipPreRun, setSkipPreRun] = useState(false);
    const [preRunDirty, setPreRunDirty] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [pendingSelection, setPendingSelection] = useState<TestSelection | null>(null);
    const [switching, setSwitching] = useState(false);
    const isLive = state.state === "running" || state.state === "pre-running" || state.state === "paused";
    const settingsDisabled = state.state === "running" || state.state === "pre-running" || state.state === "paused";

    const sameNode = (a: TestSelection["node"], b: TestSelection["node"]) =>
        (!a && !b) ||
        !!(a && b && a.kind === b.kind && a.fullTitle === b.fullTitle);

    function requestSelectionChange(next: TestSelection | null) {
        const sameAsCurrent =
            (next?.spec ?? null) === selectedSpec && sameNode(next?.node ?? null, selectedNode);
        if (sameAsCurrent) return;
        if (!isLive) {
            useStore.setState({
                selectedSpec: next?.spec ?? null,
                selectedNode: next?.node ?? null,
            });
            return;
        }
        setPendingSelection(next);
    }

    // Show the row whenever preRun is configured. First-run setup (no value)
    // is not exposed here; dev commits initial value OR user triggers the
    // row by setting preRun via a one-off settings command later.
    const showPreRun = savedPreRun.length > 0;

    // TODO(you): decide the exact enable rules for Start and Stop.
    //
    // Context: the server supports {type:"run", spec} and {type:"cancel"}.
    //   - "cancel" kills the mocha runner, aborts the agent, and resets
    //     session to "idle" — it works whether state is "running" OR "paused".
    //   - A paused test still has a live mocha process waiting on the
    //     should-continue flag, so stopping from "paused" is legitimate
    //     (it just bails the whole suite instead of resuming one test).
    //
    // Trade-off to decide:
    //   (A) Strict  — Start only when a spec is selected AND state is
    //                 "idle" or "done". Stop only when "running" or "paused".
    //                 Clear, no surprises. (5-10 lines below as a starting point.)
    //   (B) Lenient — Start also allowed when "done" re-runs the last
    //                 selection without requiring re-click; Stop also allowed
    //                 any time a runner is alive (incl. some transitional states).
    //
    // Pick what fits QA's workflow and edit the two booleans below.
    const canStart = !!selectedSpec && (state.state === "idle" || state.state === "done") && !preRunDirty;
    const canStop = state.state === "running" || state.state === "paused";

    return (
        <div className="flex h-screen">
            <TestTree
                suites={suites}
                selection={selection}
                onSelect={(sel) => requestSelectionChange(sel)}
                onOpenSettings={() => setSettingsOpen(true)}
                settingsDisabled={settingsDisabled}
            />
            <main className="flex-1 p-4 overflow-auto space-y-4">
                <div className="flex items-center gap-3">
                    <EfButton
                        cta
                        disabled={!canStart || undefined}
                        onClick={() => {
                            if (!canStart) return;
                            const grep = mochaGrepFor(selectedNode) ?? undefined;
                            send({ type: "run", spec: selectedSpec!, skipPreRun, grep });
                        }}
                    >
                        Start
                    </EfButton>
                    <EfButton
                        disabled={!canStop || undefined}
                        onClick={() => {
                            if (canStop) send({ type: "cancel" });
                        }}
                    >
                        Stop
                    </EfButton>
                    {(state.state === "running" || state.state === "pre-running") && <Spinner />}
                    <span>Status: {state.state}</span>
                    {showPreRun && (
                        <PreRunRow
                            saved={savedPreRun}
                            skip={skipPreRun}
                            disabled={state.state === "running" || state.state === "pre-running" || state.state === "paused"}
                            onSave={(preRun) => send({ type: "settings_update", preRun })}
                            onSkipChange={setSkipPreRun}
                            onDirtyChange={setPreRunDirty}
                        />
                    )}
                    {state.state === "paused" && (
                        <EfButton cta onClick={() => send({ type: "continue" })}>
                            Continue
                        </EfButton>
                    )}
                    <ModeToggle
                        mode={mode}
                        disabled={state.state === "running" || state.state === "pre-running" || state.state === "paused"}
                        onChange={(m) => send({ type: "settings_update", mode: m })}
                    />
                    <button
                        type="button"
                        aria-label="settings"
                        className="ml-auto px-2 py-1 rounded border border-gray-600 text-sm disabled:opacity-40"
                        disabled={settingsDisabled}
                        onClick={() => setSettingsOpen(true)}
                    >
                        ⚙
                    </button>
                </div>
                <SettingsDialog
                    open={settingsOpen}
                    config={config}
                    onSave={(patch) => {
                        send({ type: "settings_update", ...patch });
                        setSettingsOpen(false);
                    }}
                    onClose={() => setSettingsOpen(false)}
                />
                <SelectionPanel
                    spec={selectedSpec}
                    node={selectedNode}
                    onClear={() => useStore.setState({ selectedNode: null })}
                />
                {selectedSpec && selectedNode && previewCode && (
                    <CodePreview
                        code={previewCode}
                        startLine={matchedNode!.line}
                        language={languageFromPath(selectedSpec)}
                        title={`${selectedSpec}:${matchedNode!.line}`}
                    />
                )}
                {state.currentFailure && <FailureCard failure={state.currentFailure} />}
                <MochaLogPanel />
                {diff && (
                    <DiffView
                        file={diff.file}
                        oldCode={diff.oldCode}
                        newCode={diff.newCode}
                        onApprove={() => {
                            send({ type: "diff_decision", reqId: diff.reqId, action: "approved" });
                            useStore.setState({ pendingDiff: null });
                        }}
                        onReject={() => {
                            send({ type: "diff_decision", reqId: diff.reqId, action: "rejected", reason: "" });
                            useStore.setState({ pendingDiff: null });
                        }}
                    />
                )}
                {pendingSelection !== null && (
                    <EfDialog
                        opened
                        header="Switch suite?"
                        aria-label="Switch suite?"
                        role="dialog"
                        onCancel={() => { if (!switching) setPendingSelection(null); }}
                    >
                        {!switching && (
                            <div className="space-y-2 p-4">
                                <p>A run is in progress. Switching will stop it. Continue?</p>
                                <div className="text-xs opacity-70 font-mono">
                                    Current: {selectedSpec}{selectedNode ? ` — ${selectedNode.fullTitle}` : ""}
                                </div>
                                <div className="text-xs opacity-70 font-mono">
                                    New: {pendingSelection?.spec ?? "(clear selection)"}
                                    {pendingSelection?.node ? ` — ${pendingSelection.node.fullTitle}` : pendingSelection ? " — whole file" : ""}
                                </div>
                                <div className="flex gap-2 pt-2">
                                    <EfButton cta onClick={() => {
                                        setSwitching(true);
                                        send({ type: "cancel" });
                                    }}>Switch</EfButton>
                                    <EfButton onClick={() => setPendingSelection(null)}>Keep running</EfButton>
                                </div>
                            </div>
                        )}
                        {switching && (
                            <div className="flex items-center gap-3 p-4">
                                <Spinner />
                                <span>Stopping current run…</span>
                            </div>
                        )}
                    </EfDialog>
                )}
            </main>
            <ChatDrawer
                onSend={(prompt) => send({ type: "chat_send", prompt })}
                onAbort={() => send({ type: "agent_abort" })}
                pendingPrompt={prompt}
                onPromptRespond={({ choice, freeText }) => {
                    if (!prompt) return;
                    send({ type: "prompt_response", reqId: prompt.reqId, choice, freeText });
                    useStore.setState({ pendingPrompt: null });
                }}
            />
            {pick && (
                <PickerOverlay
                    imageUrl={pick.imageUrl}
                    hint={pick.hint}
                    onPick={(coords) => {
                        send({ type: "pick_result", reqId: pick.reqId, selector: "", attrs: { coords } });
                        useStore.setState({ pendingPick: null });
                    }}
                    onCancel={() => {
                        send({ type: "pick_result", reqId: pick.reqId, selector: "", attrs: { cancelled: true } });
                        useStore.setState({ pendingPick: null });
                    }}
                />
            )}
        </div>
    );
}
