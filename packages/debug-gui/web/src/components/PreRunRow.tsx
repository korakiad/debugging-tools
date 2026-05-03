import { useEffect, useState } from "react";
import { EfButton, EfCheckbox, EfTextField } from "../ui";

export interface PreRunRowProps {
    saved: string;
    skip: boolean;
    disabled: boolean;
    onSave: (value: string) => void;
    onSkipChange: (next: boolean) => void;
    onDirtyChange?: (dirty: boolean) => void;
}

export function PreRunRow({
    saved, skip, disabled, onSave, onSkipChange, onDirtyChange,
}: PreRunRowProps) {
    const [value, setValue] = useState(saved);

    useEffect(() => { setValue(saved); }, [saved]);
    useEffect(() => { onDirtyChange?.(value !== saved); }, [value, saved, onDirtyChange]);

    const dirty = value !== saved;
    const saveDisabled = !dirty || disabled;

    return (
        <div className="flex items-center gap-2 text-sm">
            <label className="opacity-70" htmlFor="prerun-input">Pre-run:</label>
            <EfTextField
                id="prerun-input"
                aria-label="pre-run"
                style={{ width: "16rem" }}
                placeholder="e.g. npm run build"
                value={value}
                onValueChanged={(e) =>
                    setValue((e as CustomEvent<{ value: string }>).detail.value)
                }
                disabled={disabled || undefined}
            />
            <EfButton
                disabled={saveDisabled || undefined}
                onClick={() => onSave(value)}
            >
                Save
            </EfButton>
            <label className="flex items-center gap-1 opacity-80">
                <EfCheckbox
                    aria-label="skip this run"
                    checked={skip}
                    onCheckedChanged={(e) =>
                        onSkipChange((e as CustomEvent<{ value: boolean }>).detail.value)
                    }
                    disabled={disabled || undefined}
                />
                Skip this run
            </label>
        </div>
    );
}
