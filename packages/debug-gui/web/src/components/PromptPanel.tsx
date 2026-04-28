import { useState } from "react";
import { EfButton, EfPanel } from "../ui";

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
                className="px-3 py-2 text-sm"
                style={{ borderBottom: "1px solid var(--ef-border-color)" }}
            >
                {summary}
            </div>
            <div className="p-2 flex flex-col gap-2">
                {options.map((o) => (
                    <button
                        type="button"
                        key={o.id}
                        className="prompt-option"
                        onClick={() =>
                            onRespond({
                                choice: o.id,
                                freeText: trimmed.length > 0 ? trimmed : null,
                            })
                        }
                    >
                        <span className="prompt-option__label">{o.label}</span>
                        {o.detail && (
                            <span className="prompt-option__detail">{o.detail}</span>
                        )}
                    </button>
                ))}
            </div>
            {allowFreeText && (
                <div
                    className="p-2 flex items-end gap-2"
                    style={{ borderTop: "1px solid var(--ef-border-color)" }}
                >
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={2}
                        placeholder="Add notes (optional)…"
                        className="prompt-textarea"
                    />
                    <EfButton
                        cta
                        disabled={sendDisabled || undefined}
                        onClick={() => {
                            if (sendDisabled) return;
                            onRespond({
                                choice: null,
                                freeText: trimmed.length > 0 ? trimmed : null,
                            });
                        }}
                    >
                        Send
                    </EfButton>
                </div>
            )}
        </EfPanel>
    );
}
