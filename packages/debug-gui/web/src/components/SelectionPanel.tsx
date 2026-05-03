import type { SelectedNode } from "../state/store";
import { EfButton } from "../ui";

export interface SelectionPanelProps {
    spec: string | null;
    node: SelectedNode | null;
    onClear?: () => void;
}

// Surfaces the user's current selection in the middle panel so it's the
// first thing they see — Start runs exactly what's listed here. We split the
// fullTitle into segments using a heuristic ("describe" vs "it" leaf), but
// keep the original Mocha join (single space) for fidelity with --grep.
export function SelectionPanel({ spec, node, onClear }: SelectionPanelProps) {
    if (!spec) {
        return (
            <div
                role="region"
                aria-label="selection"
                className="border border-gray-700 rounded p-3 bg-neutral-900/40 text-sm"
            >
                <span className="opacity-60">
                    Pick a suite, describe, or test from the left to begin.
                </span>
            </div>
        );
    }

    return (
        <div
            role="region"
            aria-label="selection"
            className="border border-gray-700 rounded p-3 bg-neutral-900/40 flex items-start gap-3"
        >
            <div className="flex-1 min-w-0 space-y-1">
                <div className="text-xs opacity-60">Will run on Start</div>
                <div className="text-sm font-mono break-all" data-testid="selection-spec">
                    {spec}
                </div>
                {node ? (
                    <div className="text-sm flex items-baseline gap-2 flex-wrap" data-testid="selection-node">
                        <span className="text-xs uppercase tracking-wide opacity-70 px-1.5 py-0.5 rounded border border-gray-600">
                            {node.kind}
                        </span>
                        <span className="break-all">{node.fullTitle}</span>
                    </div>
                ) : (
                    <div className="text-xs opacity-60" data-testid="selection-whole">
                        Whole file — every test in this spec.
                    </div>
                )}
            </div>
            {node && onClear && (
                <EfButton
                    transparent
                    onClick={onClear}
                    aria-label="clear selection (run whole file)"
                    title="Run whole file instead"
                >
                    Run whole file
                </EfButton>
            )}
        </div>
    );
}
