import { useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useStore } from "./state/store";
import { TestTree } from "./components/TestTree";
import { FailureCard } from "./components/FailureCard";
import { DiffView } from "./components/DiffView";
import { PickerOverlay } from "./components/PickerOverlay";
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
    const diff = useStore((s) => s.pendingDiff);
    const pick = useStore((s) => s.pendingPick);
    const config = useStore((s) => s.config) as { preRun?: string } & DebugGuiConfigShape;
    const savedPreRun = config.preRun ?? "";
    // Skip defaults to unchecked on every reload. Persisting it would let a
    // user accidentally skip builds session after session; the design calls
    // out "always run build" as the safe default.
    const [skipPreRun, setSkipPreRun] = useState(false);
    const [preRunDirty, setPreRunDirty] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsDisabled = state.state === "running" || state.state === "pre-running" || state.state === "paused";

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
                selectedSpec={selectedSpec}
                onSelect={(spec) => useStore.setState({ selectedSpec: spec })}
                onOpenSettings={() => setSettingsOpen(true)}
                settingsDisabled={settingsDisabled}
            />
            <main className="flex-1 p-4 overflow-auto space-y-4">
                <div className="flex items-center gap-3">
                    <EfButton
                        cta
                        disabled={!canStart || undefined}
                        onClick={() => {
                            if (canStart) send({ type: "run", spec: selectedSpec!, skipPreRun });
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
                    {selectedSpec && (
                        <span className="text-xs opacity-70 truncate max-w-xs" title={selectedSpec}>
                            {selectedSpec}
                        </span>
                    )}
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
            </main>
            <ChatDrawer
                onSend={(prompt) => send({ type: "chat_send", prompt })}
                onAbort={() => send({ type: "agent_abort" })}
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
