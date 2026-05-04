import { useEffect, useRef, useState } from "react";
import { useStore, type Prompt } from "../state/store";
import { Spinner } from "./Spinner";
import { PromptPanel } from "./PromptPanel";
import { EfButton, EfTextField } from "../ui";

export function ChatDrawer({
    onSend,
    onAbort,
    pendingPrompt,
    onPromptRespond,
}: {
    onSend: (prompt: string) => void;
    onAbort: () => void;
    pendingPrompt: Prompt | null;
    onPromptRespond: (r: { choice: string | null; freeText: string | null }) => void;
}) {
    const messages = useStore((s) => s.chatMessages);
    const thinking = useStore((s) => s.agentThinking);
    const activity = useStore((s) => s.agentActivity);
    const [prompt, setPrompt] = useState("");

    // Auto-scroll the chat scroll region to the bottom when a new message
    // arrives, the agent starts/stops thinking, or an ask_user prompt
    // appears. Without this, a long history hides the latest assistant
    // turn (incl. a blocking prompt) below the fold and QA misses it.
    // Tail .content so streaming chat_delta events (which mutate the last
    // message in place rather than appending) keep the view pinned.
    const scrollRef = useRef<HTMLDivElement>(null);
    const lastContent = messages[messages.length - 1]?.content;
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length, lastContent, pendingPrompt, thinking]);

    const submit = () => {
        if (prompt.trim()) {
            onSend(prompt);
            setPrompt("");
        }
    };

    return (
        <section className="chat-drawer" aria-label="Agent chat">
            <header className="chat-drawer-header">Chat</header>
            <div
                ref={scrollRef}
                role="log"
                aria-live="polite"
                className="chat-drawer-log"
            >
                {messages.map((m, i) => (
                    <div key={i} className="chat-drawer-message">
                        <div className="chat-drawer-role">{m.role}:</div>
                        <div className="chat-drawer-content">{m.content}</div>
                    </div>
                ))}
                {thinking && (
                    <div className="chat-drawer-thinking">
                        <Spinner />
                        <span>{activity || "Agent thinking…"}</span>
                        <span className="chat-drawer-stop">
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
                className="chat-drawer-input"
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
        </section>
    );
}
