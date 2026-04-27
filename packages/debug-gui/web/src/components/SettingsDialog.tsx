import { useEffect, useState } from "react";
import { TreePicker } from "./TreePicker";
import { selectionToGlobs } from "../lib/projection";

export interface DebugGuiConfigShape {
    discovery?: { globs?: string[]; exclude?: string[]; extensions?: string[] };
    agent?: { idleTimeoutMs?: number };
}

export interface SettingsPatch {
    idleTimeoutMs?: number;
    discovery?: { globs?: string[]; exclude?: string[]; extensions?: string[] };
}

// Parse the extensions text field: "js, ts ,  tsx" → ["js", "ts", "tsx"].
// Strips leading dots so "  .jsx  " still works, drops blanks and dupes.
export function parseExtensionsInput(raw: string): string[] {
    const seen = new Set<string>();
    for (const token of raw.split(",")) {
        const clean = token.trim().replace(/^\./, "");
        if (clean) seen.add(clean);
    }
    return [...seen];
}

export interface SettingsDialogProps {
    open: boolean;
    config: DebugGuiConfigShape;
    onSave: (patch: SettingsPatch) => void;
    onClose: () => void;
}

const DEFAULT_GLOBS = ["test/**/*.spec.{js,ts}", "spec/**/*.test.{js,ts}"];
const DEFAULT_IDLE_MINUTES = 10;

function arraysEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function SettingsDialog({ open, config, onSave, onClose }: SettingsDialogProps) {
    const savedGlobs = config.discovery?.globs ?? DEFAULT_GLOBS;
    const savedExclude = config.discovery?.exclude ?? [];
    const savedExtensions = config.discovery?.extensions ?? [];
    const savedIdleMin = Math.round((config.agent?.idleTimeoutMs ?? DEFAULT_IDLE_MINUTES * 60_000) / 60_000);

    const [globs, setGlobs] = useState<string[]>(savedGlobs);
    const [exclude, setExclude] = useState<string[]>(savedExclude);
    const [extensionsInput, setExtensionsInput] = useState<string>(savedExtensions.join(", "));
    const [idleMin, setIdleMin] = useState<number>(savedIdleMin);
    const [pickerOpen, setPickerOpen] = useState(false);

    // Re-seed local state whenever the dialog opens with fresh config.
    useEffect(() => {
        if (open) {
            setGlobs(savedGlobs);
            setExclude(savedExclude);
            setExtensionsInput(savedExtensions.join(", "));
            setIdleMin(savedIdleMin);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!open) return null;

    const parsedExtensions = parseExtensionsInput(extensionsInput);
    const globsChanged = !arraysEqual(globs, savedGlobs);
    const excludeChanged = !arraysEqual(exclude, savedExclude);
    const extensionsChanged = !arraysEqual(parsedExtensions, savedExtensions);
    const idleChanged = idleMin !== savedIdleMin;
    const dirty = globsChanged || excludeChanged || extensionsChanged || idleChanged;
    const idleValid = Number.isFinite(idleMin) && idleMin >= 1;
    const canSave = dirty && idleValid;

    const handleSave = () => {
        const patch: SettingsPatch = {};
        if (idleChanged) patch.idleTimeoutMs = idleMin * 60_000;
        if (globsChanged || excludeChanged || extensionsChanged) {
            patch.discovery = {};
            if (globsChanged) patch.discovery.globs = globs;
            if (excludeChanged) patch.discovery.exclude = exclude;
            if (extensionsChanged) patch.discovery.extensions = parsedExtensions;
        }
        onSave(patch);
    };

    return (
        <div
            role="dialog"
            aria-labelledby="settings-title"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={onClose}
        >
            <div
                className="bg-neutral-900 border border-gray-700 rounded shadow-xl p-5 w-[560px] max-h-[85vh] overflow-auto text-sm"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 id="settings-title" className="text-base font-semibold mb-4">Settings</h2>

                <section className="mb-5">
                    <h3 className="font-semibold mb-2">Test file extensions</h3>
                    <p className="opacity-70 text-xs mb-2">
                        Comma-separated. Leave blank to infer from existing globs. Example: <code className="font-mono">js, ts</code>
                    </p>
                    <input
                        type="text"
                        aria-label="extensions"
                        value={extensionsInput}
                        placeholder="js, ts"
                        onChange={(e) => setExtensionsInput(e.target.value)}
                        className="px-2 py-1 rounded border border-gray-600 bg-transparent font-mono text-xs w-full"
                    />
                    {parsedExtensions.length > 0 && (
                        <p className="opacity-60 text-xs mt-1">
                            Will be applied as <code className="font-mono">{parsedExtensions.length === 1 ? `.${parsedExtensions[0]}` : `.{${parsedExtensions.join(",")}}`}</code>
                        </p>
                    )}
                </section>

                <section className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold">Test discovery globs</h3>
                        <button
                            type="button"
                            onClick={() => setPickerOpen(true)}
                            className="px-2 py-1 rounded border border-gray-600 text-xs"
                        >
                            Browse…
                        </button>
                    </div>
                    <p className="opacity-70 text-xs mb-2">
                        Patterns used to find test files (relative to the project root).
                    </p>
                    <GlobList
                        values={globs}
                        onChange={setGlobs}
                        inputAriaLabel="glob"
                        addLabel="Add glob"
                        placeholder="test/**/*.spec.{js,ts}"
                    />
                </section>

                <TreePicker
                    open={pickerOpen}
                    extensions={parsedExtensions}
                    onCancel={() => setPickerOpen(false)}
                    onPick={(selection) => {
                        const next = selectionToGlobs(selection, {
                            currentGlobs: globs,
                            extensions: parsedExtensions,
                        });
                        setGlobs(next);
                        setPickerOpen(false);
                    }}
                />

                <section className="mb-5">
                    <h3 className="font-semibold mb-2">Ignore patterns</h3>
                    <p className="opacity-70 text-xs mb-2">
                        Files matching these patterns are excluded from discovery.
                    </p>
                    <GlobList
                        values={exclude}
                        onChange={setExclude}
                        inputAriaLabel="exclude"
                        addLabel="Add exclude"
                        placeholder="node_modules/**"
                    />
                </section>

                <section className="mb-5">
                    <h3 className="font-semibold mb-2">Agent idle timeout</h3>
                    <label className="flex items-center gap-2">
                        <input
                            type="number"
                            aria-label="idle timeout minutes"
                            min={1}
                            value={Number.isFinite(idleMin) ? idleMin : ""}
                            onChange={(e) => setIdleMin(Number(e.target.value))}
                            className="px-2 py-1 rounded border border-gray-600 bg-transparent w-24 font-mono"
                        />
                        <span className="opacity-70">minutes</span>
                    </label>
                    {!idleValid && (
                        <p className="text-red-400 text-xs mt-1">Must be at least 1 minute.</p>
                    )}
                </section>

                <div className="flex justify-end gap-2 mt-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1 rounded border border-gray-600"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        disabled={!canSave}
                        onClick={handleSave}
                        className="px-3 py-1 rounded border border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}

interface GlobListProps {
    values: string[];
    onChange: (next: string[]) => void;
    inputAriaLabel: string;
    addLabel: string;
    placeholder?: string;
}

function GlobList({ values, onChange, inputAriaLabel, addLabel, placeholder }: GlobListProps) {
    return (
        <div className="space-y-1">
            {values.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                    <input
                        type="text"
                        aria-label={`${inputAriaLabel} ${i + 1}`}
                        value={v}
                        placeholder={placeholder}
                        onChange={(e) => {
                            const next = [...values];
                            next[i] = e.target.value;
                            onChange(next);
                        }}
                        className="px-2 py-1 rounded border border-gray-600 bg-transparent font-mono text-xs flex-1"
                    />
                    <button
                        type="button"
                        aria-label={`remove ${inputAriaLabel} ${i + 1}`}
                        onClick={() => onChange(values.filter((_, j) => j !== i))}
                        className="px-2 py-1 rounded border border-gray-600 text-xs"
                    >
                        Remove
                    </button>
                </div>
            ))}
            {values.length === 0 && (
                <p className="opacity-60 text-xs">No patterns yet.</p>
            )}
            <button
                type="button"
                onClick={() => onChange([...values, ""])}
                className="px-2 py-1 rounded border border-gray-600 text-xs"
            >
                {addLabel}
            </button>
        </div>
    );
}
