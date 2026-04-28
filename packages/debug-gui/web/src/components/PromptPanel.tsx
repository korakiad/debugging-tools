import { useState } from "react";
import { EfPanel } from "../ui";

export interface PromptOption {
    id: string;
    label: string;
    detail?: string;
}

export function PromptPanel({
    summary,
    options,
    allowFreeText,
    onRespond,
}: {
    summary: string;
    options: PromptOption[];
    allowFreeText: boolean;
    onRespond: (r: { choice: string | null; freeText: string | null }) => void;
}) {
    const [text, setText] = useState("");
    const trimmed = text.trim();
    const sendDisabled = options.length === 0 && trimmed.length === 0;

    return (
        <EfPanel spacing style={{ display: "block" }}>
            <div
                className="p-2 text-sm"
                style={{ borderBottom: "1px solid var(--ef-border-color)" }}
            >
                {summary}
            </div>
            <div className="p-2 flex flex-col gap-2">
                {options.map((o) => (
                    <button
                        type="button"
                        key={o.id}
                        onClick={() =>
                            onRespond({
                                choice: o.id,
                                freeText: trimmed.length > 0 ? trimmed : null,
                            })
                        }
                        className="text-left px-3 py-2 rounded border"
                        style={{
                            borderColor: "var(--ef-border-color)",
                            background: "var(--ef-content-secondary-background-color)",
                            color: "var(--ef-color)",
                        }}
                    >
                        <div className="font-bold text-sm">{o.label}</div>
                        {o.detail && (
                            <div className="text-xs opacity-70">{o.detail}</div>
                        )}
                    </button>
                ))}
            </div>
            {allowFreeText && (
                <div
                    className="p-2 flex flex-col gap-2"
                    style={{ borderTop: "1px solid var(--ef-border-color)" }}
                >
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={2}
                        className="p-1 text-sm rounded"
                        style={{
                            background: "var(--ef-content-primary-background-color)",
                            border: "1px solid var(--ef-border-color)",
                            color: "var(--ef-color)",
                        }}
                    />
                    <button
                        type="button"
                        disabled={sendDisabled}
                        onClick={() => {
                            if (sendDisabled) return;
                            onRespond({
                                choice: null,
                                freeText: trimmed.length > 0 ? trimmed : null,
                            });
                        }}
                        className="self-end px-3 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                            borderColor: "var(--ef-border-color)",
                            background: "var(--ef-accent-color)",
                            color: "var(--ef-content-primary-color)",
                        }}
                    >
                        Send
                    </button>
                </div>
            )}
        </EfPanel>
    );
}
