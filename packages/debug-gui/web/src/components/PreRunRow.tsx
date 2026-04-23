import { useEffect, useState } from "react";

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
            <input
                id="prerun-input"
                aria-label="pre-run"
                className="px-2 py-1 rounded border border-gray-600 bg-transparent font-mono text-xs w-64"
                placeholder="e.g. npm run build"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={disabled}
            />
            <button
                type="button"
                className="px-2 py-1 rounded border border-gray-600 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={saveDisabled}
                onClick={() => onSave(value)}
            >
                Save
            </button>
            <label className="flex items-center gap-1 opacity-80">
                <input
                    type="checkbox"
                    checked={skip}
                    onChange={(e) => onSkipChange(e.target.checked)}
                    disabled={disabled}
                />
                Skip this run
            </label>
        </div>
    );
}
