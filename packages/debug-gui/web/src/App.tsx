import { useWebSocket } from "./hooks/useWebSocket";
import { useStore } from "./state/store";
import { TestTree } from "./components/TestTree";
import { FailureCard } from "./components/FailureCard";
import { DiffView } from "./components/DiffView";
import { PickerOverlay } from "./components/PickerOverlay";
import { ChatDrawer } from "./components/ChatDrawer";
import { MochaLogPanel } from "./components/MochaLogPanel";
import { Spinner } from "./components/Spinner";

export default function App() {
    const { send } = useWebSocket();
    const suites = useStore((s) => s.suites);
    const state = useStore((s) => s.state);
    const diff = useStore((s) => s.pendingDiff);
    const pick = useStore((s) => s.pendingPick);

    return (
        <div className="flex h-screen">
            <TestTree suites={suites} onRun={(spec) => send({ type: "run", spec })} />
            <main className="flex-1 p-4 overflow-auto space-y-4">
                <div className="flex items-center gap-3">
                    {state.state === "running" && <Spinner />}
                    <span>Status: {state.state}</span>
                    {state.state === "paused" && (
                        <button
                            className="bg-blue-600 text-white px-3 py-1 rounded text-sm"
                            onClick={() => send({ type: "continue" })}
                        >
                            Continue
                        </button>
                    )}
                </div>
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
