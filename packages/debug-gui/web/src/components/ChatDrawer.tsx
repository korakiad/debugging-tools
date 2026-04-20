import { useStore } from "../state/store";
import { Spinner } from "./Spinner";

export function ChatDrawer({
    onSend,
    onAbort,
}: {
    onSend: (prompt: string) => void;
    onAbort: () => void;
}) {
    const messages = useStore((s) => s.chatMessages);
    const thinking = useStore((s) => s.agentThinking);
    const activity = useStore((s) => s.agentActivity);
    return (
        <aside className="w-96 border-l h-full flex flex-col">
            <h2 className="p-2 font-bold text-sm border-b">Chat</h2>
            <div className="flex-1 overflow-auto p-2 space-y-2">
                {messages.map((m, i) => (
                    <div key={i} className="text-sm">
                        <div className="font-bold">{m.role}:</div>
                        <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                ))}
                {thinking && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 italic">
                        <Spinner />
                        <span>{activity || "Agent thinking…"}</span>
                        <button
                            type="button"
                            onClick={onAbort}
                            className="ml-auto px-2 py-0.5 text-xs rounded border border-gray-300 not-italic text-gray-700 hover:bg-gray-100"
                            aria-label="Stop agent"
                        >
                            Stop
                        </button>
                    </div>
                )}
            </div>
            <form
                className="flex border-t"
                onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem("prompt") as HTMLInputElement;
                    if (input.value) {
                        onSend(input.value);
                        input.value = "";
                    }
                }}
            >
                <input name="prompt" className="flex-1 p-2 text-sm" placeholder="Ask..." />
                <button className="px-3">Send</button>
            </form>
        </aside>
    );
}
