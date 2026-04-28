import { useState } from "react";
import { useStore } from "../state/store";
import { Spinner } from "./Spinner";
import { PromptPanel, type PromptOption } from "./PromptPanel";
import { EfButton, EfTextField } from "../ui";

export function ChatDrawer({
    onSend,
    onAbort,
    pendingPrompt,
    onPromptRespond,
}: {
    onSend: (prompt: string) => void;
    onAbort: () => void;
    pendingPrompt: {
        summary: string;
        options: PromptOption[];
        allowFreeText: boolean;
    } | null;
    onPromptRespond: (r: { choice: string | null; freeText: string | null }) => void;
}) {
    const messages = useStore((s) => s.chatMessages);
    const thinking = useStore((s) => s.agentThinking);
    const activity = useStore((s) => s.agentActivity);
    const [prompt, setPrompt] = useState("");

    const submit = () => {
        if (prompt.trim()) {
            onSend(prompt);
            setPrompt("");
        }
    };

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
                    <div className="flex items-center gap-2 text-sm italic opacity-70">
                        <Spinner />
                        <span>{activity || "Agent thinking…"}</span>
                        <span className="ml-auto not-italic">
                            <EfButton transparent onClick={onAbort} aria-label="Stop agent">
                                Stop
                            </EfButton>
                        </span>
                    </div>
                )}
                {pendingPrompt && (
                    <PromptPanel
                        summary={pendingPrompt.summary}
                        options={pendingPrompt.options}
                        allowFreeText={pendingPrompt.allowFreeText}
                        onRespond={onPromptRespond}
                    />
                )}
            </div>
            <div
                className="flex border-t p-2 gap-2"
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                    }
                }}
            >
                <EfTextField
                    style={{ flex: 1 }}
                    placeholder="Ask..."
                    value={prompt}
                    onValueChanged={(e) => setPrompt((e as CustomEvent<{ value: string }>).detail.value)}
                />
                <EfButton cta onClick={submit}>
                    Send
                </EfButton>
            </div>
        </aside>
    );
}
