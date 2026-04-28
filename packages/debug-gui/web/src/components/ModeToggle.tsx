import type React from "react";
import { EfButton } from "../ui";

export type AgentMode = "auto" | "manual";

export function ModeToggle({
    mode,
    disabled,
    onChange,
}: {
    mode: AgentMode;
    disabled: boolean;
    onChange: (next: AgentMode) => void;
}) {
    return (
        <div className="inline-flex gap-1">
            {(["auto", "manual"] as const).map((m) => {
                const active = mode === m;
                const props: Record<string, unknown> = {
                    onClick: (e: React.MouseEvent<HTMLElement>) => {
                        // Blur immediately so refinitiv-ui's focus halo doesn't
                        // linger on top of the cta blue — this toggle is a
                        // momentary action, not a focused form control.
                        e.currentTarget.blur();
                        if (!active && !disabled) onChange(m);
                    },
                };
                if (active) props.cta = true;
                if (disabled) props["aria-disabled"] = "true";
                if (disabled) props.disabled = true;
                return (
                    <EfButton
                        key={m}
                        aria-pressed={active}
                        {...props}
                    >
                        {m === "auto" ? "Auto" : "Manual"}
                    </EfButton>
                );
            })}
        </div>
    );
}
