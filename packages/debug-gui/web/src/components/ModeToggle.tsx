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
        <div
            className="inline-flex rounded border"
            style={{ borderColor: "var(--ef-border-color)" }}
        >
            {(["auto", "manual"] as const).map((m) => {
                const active = mode === m;
                return (
                    <button
                        key={m}
                        type="button"
                        aria-pressed={active}
                        disabled={disabled}
                        className="px-2 py-1 text-xs disabled:opacity-40"
                        style={{
                            background: active ? "var(--ef-accent-color)" : "transparent",
                            color: active ? "var(--ef-content-primary-color)" : "inherit",
                        }}
                        onClick={() => {
                            if (!active) onChange(m);
                        }}
                    >
                        {m === "auto" ? "Auto" : "Manual"}
                    </button>
                );
            })}
        </div>
    );
}
