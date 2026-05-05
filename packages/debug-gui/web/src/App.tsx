import { useEffect, useRef, useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useStore } from "./state/store";
import { TestTree, type TestSelection } from "./components/TestTree";
import { EfDialog } from "./ui/EfDialog";
import { EmptyHero } from "./components/EmptyHero";
import { CodePreview, languageFromPath, sliceSource } from "./components/CodePreview";
import { mochaGrepFor } from "./lib/mochaGrep";
import { findNode } from "./lib/findNode";
import { FailureCard } from "./components/FailureCard";
import { DiffView } from "./components/DiffView";
import { PickerOverlay } from "./components/PickerOverlay";
import { ModeToggle, type AgentMode } from "./components/ModeToggle";
import { ChatDrawer } from "./components/ChatDrawer";
import { RightPanel } from "./components/RightPanel";
import { LogPanel } from "./components/LogPanel";
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
    // Captured at the moment the suite-switch dialog opens so we can restore
    // focus to whatever row QA clicked once the dialog closes (Keep running,
    // Switch+apply, or auto-dismiss). Without this, focus lands on
    // <body>, which breaks keyboard navigation.
    const dialogReturnFocus = useRef<HTMLElement | null>(null);
    const dialogWasOpen = useRef(false);
    const isLive = state.state === "running" || state.state === "pre-running" || state.state === "paused";
    const settingsDisabled = isLive || switching;

    const sameNode = (a: TestSelection["node"], b: TestSelection["node"]) =>
        (!a && !b) ||
        !!(a && b && a.kind === b.kind && a.fullTitle === b.fullTitle);

    function requestSelectionChange(next: TestSelection | null) {
        if (switching) return;
        const sameAsCurrent =
            (next?.spec ?? null) === selectedSpec && sameNode(next?.node ?? null, selectedNode);
        if (sameAsCurrent) return;
        if (!isLive) {
            useStore.getState().selectSuite(next?.spec ?? null, next?.node ?? null);
            return;
        }
        // About to open the dialog — capture the element that will lose
        // focus when refinitiv-ui's <ef-dialog> moves focus to the modal,
        // so we can put it back when the dialog closes.
        const active = document.activeElement;
        dialogReturnFocus.current = active instanceof HTMLElement ? active : null;
        setPendingSelection(next);
    }

    // Focus restore for the suite-switch dialog. Whenever the dialog
    // transitions from open → closed (any path: Keep running, Switch+apply,
    // auto-dismiss from natural finish), put focus back on the row QA
    // originally clicked. Skipped if the captured element is no longer in
    // the DOM (e.g. TestTree re-rendered with new suites).
    useEffect(() => {
        const isOpen = pendingSelection !== null;
        if (isOpen) {
            dialogWasOpen.current = true;
            return;
        }
        if (!dialogWasOpen.current) return;
        dialogWasOpen.current = false;
        const target = dialogReturnFocus.current;
        dialogReturnFocus.current = null;
        if (target && target.isConnected) {
            target.focus();
        }
    }, [pendingSelection]);

    useEffect(() => {
        if (!switching) return;
        if (state.state !== "idle" && state.state !== "done") return;
        if (pendingSelection !== null) {
            useStore.getState().selectSuite(pendingSelection.spec, pendingSelection.node);
        } else {
            useStore.getState().selectSuite(null, null);
        }
        // The cancel just landed. Force a clean idle snapshot so leftover
        // `paused` state, currentFailure, and the Continue button can't
        // linger if selectSuite read s.state.state before the WS status
        // event was applied to the store.
        useStore.setState({ state: { state: "idle" } });
        setPendingSelection(null);
        setSwitching(false);
    }, [switching, state.state, pendingSelection]);

    // Race: dialog is open (pendingSelection !== null) but the run finished
    // naturally before QA decided. The cancel branch (Switch button) is
    // pointless here — the server is already idle. Auto-apply the pending
    // selection and dismiss the dialog. QA's row-click was already a
    // commitment to that selection; the natural completion just removes
    // the need for a confirm.
    useEffect(() => {
        if (switching) return;
        if (pendingSelection === null) return;
        if (isLive) return;
        useStore.getState().selectSuite(pendingSelection.spec, pendingSelection.node);
        setPendingSelection(null);
    }, [switching, pendingSelection, isLive]);

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
    const canStart = !!selectedSpec && (state.state === "idle" || state.state === "done") && !preRunDirty && !switching;
    const canStop = (state.state === "running" || state.state === "paused") && !switching;

    return (
        <div className="flex h-screen">
            <TestTree
                suites={suites}
                selection={selection}
                onSelect={(sel) => requestSelectionChange(sel)}
                onOpenSettings={() => setSettingsOpen(true)}
                settingsDisabled={settingsDisabled}
                disabled={switching}
            />
            <main className="flex-1 p-4 overflow-auto space-y-4">
                <div className="app-toolbar">
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
                    {state.state === "paused" && (
                        <EfButton
                            cta
                            disabled={switching || undefined}
                            onClick={() => {
                                if (switching) return;
                                send({ type: "continue" });
                            }}
                        >
                            Continue
                        </EfButton>
                    )}
                    {showPreRun && (
                        <PreRunRow
                            saved={savedPreRun}
                            skip={skipPreRun}
                            disabled={settingsDisabled}
                            onSave={(preRun) => send({ type: "settings_update", preRun })}
                            onSkipChange={setSkipPreRun}
                            onDirtyChange={setPreRunDirty}
                        />
                    )}
                    <div className="app-toolbar-spacer" aria-hidden />
                    <ModeToggle
                        mode={mode}
                        disabled={settingsDisabled}
                        onChange={(m) => send({ type: "settings_update", mode: m })}
                    />
                    <span className="app-toolbar-divider" aria-hidden />
                    <EfButton
                        transparent
                        aria-label="settings"
                        className="app-toolbar-settings"
                        disabled={settingsDisabled || undefined}
                        onClick={() => setSettingsOpen(true)}
                    >
                        ⚙
                    </EfButton>
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
                {!selectedSpec ? (
                    <EmptyHero
                        title="Pick a test to begin"
                        subtitle="Choose a spec, describe, or it from the tree on the left to load its details and start a run."
                        icon={
                            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden>
                                <path
                                    d="M26 14 L14 28 L26 42"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                                <line
                                    x1="14"
                                    y1="28"
                                    x2="44"
                                    y2="28"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                />
                            </svg>
                        }
                    />
                ) : (
                    <>
                        {selectedNode && previewCode && (
                            <CodePreview
                                code={previewCode}
                                startLine={matchedNode!.line}
                                language={languageFromPath(selectedSpec)}
                                title={`${selectedSpec}:${matchedNode!.line}`}
                            />
                        )}
                        <LogPanel />
                    </>
                )}
                {pendingSelection !== null && (
                    <EfDialog
                        opened
                        header="Switch suite?"
                        aria-label="Switch suite?"
                        role="dialog"
                        onCancel={() => { if (!switching) setPendingSelection(null); }}
                    >
                        {!switching ? (
                            <div className="space-y-3 p-4 pb-6">
                                <div
                                    className="flex items-start gap-2 text-sm font-medium"
                                    style={{ color: "#ffc800" }}
                                >
                                    <span aria-hidden>⚠</span>
                                    <span>The active test run will be stopped if you switch.</span>
                                </div>
                                <div className="text-xs opacity-70 font-mono">
                                    Current: {selectedSpec}{selectedNode ? ` — ${selectedNode.fullTitle}` : ""}
                                </div>
                                <div className="text-xs opacity-70 font-mono">
                                    New: {pendingSelection?.spec ?? "(clear selection)"}
                                    {pendingSelection?.node ? ` — ${pendingSelection.node.fullTitle}` : pendingSelection ? " — whole file" : ""}
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 p-4">
                                <Spinner />
                                <span>Stopping current run…</span>
                            </div>
                        )}
                        {/* slot="footer" replaces the dialog's default OK/Cancel buttons. */}
                        <div slot="footer" className="flex justify-end items-center gap-4 px-5 py-4">
                            {!switching && (
                                <>
                                    <EfButton onClick={() => setPendingSelection(null)}>Keep running</EfButton>
                                    <EfButton
                                        cta
                                        onClick={() => {
                                            // No need to guard on switching here: this
                                            // EfButton is rendered inside the {!switching && ...}
                                            // branch above, so it cannot be clicked while a
                                            // cancel is in flight.
                                            setSwitching(true);
                                            send({ type: "cancel" });
                                        }}
                                    >Switch</EfButton>
                                </>
                            )}
                        </div>
                    </EfDialog>
                )}
            </main>
            <RightPanel>
                {state.currentFailure && <FailureCard failure={state.currentFailure} />}
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
                <ChatDrawer
                    onAbort={() => send({ type: "agent_abort" })}
                    pendingPrompt={prompt}
                    onPromptRespond={({ choice, freeText }) => {
                        if (!prompt) return;
                        send({ type: "prompt_response", reqId: prompt.reqId, choice, freeText });
                        useStore.setState({ pendingPrompt: null });
                    }}
                />
            </RightPanel>
            {pick && (
                <PickerOverlay
                    hint={pick.hint}
                    onCancel={() => {
                        send({ type: "pick_cancel", reqId: pick.reqId });
                        useStore.setState({ pendingPick: null });
                    }}
                />
            )}
        </div>
    );
}
