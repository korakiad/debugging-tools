import { useState } from "react";
import { EfButton } from "../ui";

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
        <div className="text-sm space-y-2">
            <div className="font-bold">assistant:</div>
            <div className="prompt-summary">{summary}</div>
            {options.length > 0 && (
                <div className="flex flex-col gap-2 pt-1">
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
            )}
            {allowFreeText && (
                <div className="flex items-end gap-2 pt-1">
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={2}
                        placeholder="มีอะไรที่ผมอาจมองข้ามไหม? (optional)"
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
        </div>
    );
}
