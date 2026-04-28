import { EfButton, EfButtonBar } from "../ui";

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
        <EfButtonBar managed>
            {(["auto", "manual"] as const).map((m) => {
                const active = mode === m;
                const props: Record<string, unknown> = {
                    toggles: true,
                    active,
                    onClick: () => {
                        if (!active && !disabled) onChange(m);
                    },
                };
                if (disabled) {
                    props["aria-disabled"] = "true";
                    props.disabled = true;
                }
                return (
                    <EfButton key={m} {...props}>
                        {m === "auto" ? "Auto" : "Manual"}
                    </EfButton>
                );
            })}
        </EfButtonBar>
    );
}
