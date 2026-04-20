import { useStore } from "../state/store";

export function ChatDrawer({ onSend }: { onSend: (prompt: string) => void }) {
    const messages = useStore((s) => s.chatMessages);
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
