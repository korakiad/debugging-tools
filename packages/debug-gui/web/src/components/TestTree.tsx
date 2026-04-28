import { useEffect, useState } from "react";
import { useStore, type SelectedNode } from "../state/store";

interface Suite {
    relPath: string;
    absPath: string;
}

// Server-side describe/it node (mirrors server/src/parseSuite.ts:SuiteNode).
// Keeping this duplicated rather than importing from the server keeps the
// web bundle independent of @debug-gui/server's TypeScript output.
export interface SuiteNode {
    kind: "describe" | "it";
    title: string;
    fullTitle: string;
    line: number;
    endLine: number;
    children: SuiteNode[];
    pending?: boolean;
    only?: boolean;
}

export interface SuiteTree {
    file: string;
    relPath: string;
    children: SuiteNode[];
    source?: string;
    error?: string;
}

export interface TestSelection {
    spec: string;
    node: SelectedNode | null; // null = whole file
}

export interface TestTreeProps {
    suites: Suite[];
    selection: TestSelection | null;
    onSelect: (sel: TestSelection) => void;
    onOpenSettings?: () => void;
    settingsDisabled?: boolean;
    // Test seam: lets unit tests bypass /api/suite/tree.
    fetchTree?: (spec: string) => Promise<SuiteTree>;
}

async function defaultFetchTree(spec: string): Promise<SuiteTree> {
    const res = await fetch(`/api/suite/tree?spec=${encodeURIComponent(spec)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export function TestTree({
    suites,
    selection,
    onSelect,
    onOpenSettings,
    settingsDisabled,
    fetchTree,
}: TestTreeProps) {
    // Keyed by spec relPath. We lazy-load on first expansion so the parse
    // cost only hits files the user actually opens.
    const [trees, setTrees] = useState<Record<string, SuiteTree>>({});
    const [loading, setLoading] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const doFetch = fetchTree ?? defaultFetchTree;

    // Drop any cached trees for specs that no longer exist (e.g. user edited
    // discovery globs in Settings). Otherwise stale trees would render under
    // file rows that no longer point at a real spec.
    useEffect(() => {
        setTrees((prev) => {
            const next: typeof prev = {};
            for (const s of suites) if (prev[s.relPath]) next[s.relPath] = prev[s.relPath];
            return next;
        });
    }, [suites]);

    const ensureTree = async (spec: string) => {
        if (trees[spec] || loading[spec]) return;
        setLoading((m) => ({ ...m, [spec]: true }));
        setErrors((m) => {
            const { [spec]: _, ...rest } = m;
            return rest;
        });
        try {
            const tree = await doFetch(spec);
            setTrees((m) => ({ ...m, [spec]: tree }));
            // Mirror the cache into the global store so SelectionPanel /
            // CodePreview can read the source slice without refetching.
            useStore.setState((state) => ({
                suiteTrees: { ...state.suiteTrees, [spec]: tree },
            }));
        } catch (e: any) {
            setErrors((m) => ({ ...m, [spec]: e?.message ?? String(e) }));
        } finally {
            setLoading((m) => {
                const { [spec]: _, ...rest } = m;
                return rest;
            });
        }
    };

    const toggleExpand = (spec: string) => {
        const next = !expanded[spec];
        setExpanded((m) => ({ ...m, [spec]: next }));
        if (next) void ensureTree(spec);
    };

    const isSelected = (spec: string, node: SelectedNode | null): boolean => {
        if (!selection || selection.spec !== spec) return false;
        if (!selection.node && !node) return true;
        if (!selection.node || !node) return false;
        return selection.node.kind === node.kind && selection.node.fullTitle === node.fullTitle;
    };

    return (
        <nav className="w-72 border-r h-full overflow-auto p-2">
            <h2 className="text-sm font-bold mb-2">Test Suites</h2>
            {suites.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm">
                    <p className="opacity-70 mb-1">Looks like there are no test files yet.</p>
                    <p className="opacity-60 text-xs mb-3">
                        Configure where to find them in Settings.
                    </p>
                    {onOpenSettings && (
                        <button
                            type="button"
                            onClick={onOpenSettings}
                            disabled={settingsDisabled}
                            className="px-3 py-1 rounded border border-gray-600 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Open Settings ⚙
                        </button>
                    )}
                </div>
            ) : (
                <ul className="space-y-1">
                    {suites.map((s) => {
                        const isOpen = !!expanded[s.relPath];
                        const tree = trees[s.relPath];
                        const fileSelected = isSelected(s.relPath, null);
                        return (
                            <li key={s.relPath}>
                                <div
                                    className={
                                        "suite-item suite-item-group" +
                                        (fileSelected ? " suite-item-selected" : "")
                                    }
                                >
                                    <button
                                        type="button"
                                        aria-label={isOpen ? `collapse ${s.relPath}` : `expand ${s.relPath}`}
                                        aria-expanded={isOpen}
                                        className="suite-toggle text-xs opacity-70 hover:opacity-100"
                                        onClick={() => toggleExpand(s.relPath)}
                                    >
                                        {isOpen ? "▾" : "▸"}
                                    </button>
                                    <button
                                        type="button"
                                        className="suite-row"
                                        aria-pressed={fileSelected}
                                        onClick={() => onSelect({ spec: s.relPath, node: null })}
                                    >
                                        {s.relPath}
                                    </button>
                                </div>
                                {isOpen && (
                                    <div className="ml-4 mt-1">
                                        {loading[s.relPath] && (
                                            <p className="text-xs opacity-60 px-2 py-1">Loading…</p>
                                        )}
                                        {errors[s.relPath] && (
                                            <p className="text-xs text-red-400 px-2 py-1">
                                                Failed to parse: {errors[s.relPath]}
                                            </p>
                                        )}
                                        {tree?.error && (
                                            <p className="text-xs text-red-400 px-2 py-1">
                                                Parse error: {tree.error}
                                            </p>
                                        )}
                                        {tree && tree.children.length === 0 && !tree.error && (
                                            <p className="text-xs opacity-60 px-2 py-1">
                                                No describe/it found — running this file will run all
                                                tests Mocha discovers at runtime.
                                            </p>
                                        )}
                                        {tree && tree.children.length > 0 && (
                                            <ul className="space-y-0.5">
                                                {tree.children.map((node, i) => (
                                                    <NodeRow
                                                        key={`${node.kind}:${node.fullTitle}:${i}`}
                                                        node={node}
                                                        depth={0}
                                                        spec={s.relPath}
                                                        isSelected={isSelected}
                                                        onSelect={onSelect}
                                                    />
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </nav>
    );
}

function NodeRow({
    node,
    depth,
    spec,
    isSelected,
    onSelect,
}: {
    node: SuiteNode;
    depth: number;
    spec: string;
    isSelected: (spec: string, node: SelectedNode | null) => boolean;
    onSelect: (sel: TestSelection) => void;
}) {
    // describe blocks are open by default — most QA suites are 1-2 levels
    // deep, so chasing carets adds friction with no payoff.
    const [open, setOpen] = useState(true);
    const sel: SelectedNode = { kind: node.kind, fullTitle: node.fullTitle };
    const dynamic = node.title === "<dynamic>" || node.title === "<missing>";
    const selected = isSelected(spec, sel);

    return (
        <li>
            <div
                className={
                    "suite-item " +
                    (node.kind === "describe" ? "suite-item-group " : "") +
                    (selected ? "suite-item-selected " : "")
                }
                style={{ paddingLeft: `${depth * 12}px` }}
            >
                {node.kind === "describe" && node.children.length > 0 ? (
                    <button
                        type="button"
                        aria-label={open ? `collapse ${node.title}` : `expand ${node.title}`}
                        aria-expanded={open}
                        className="suite-toggle text-xs opacity-70 hover:opacity-100"
                        onClick={() => setOpen((v) => !v)}
                    >
                        {open ? "▾" : "▸"}
                    </button>
                ) : (
                    <span className="suite-toggle text-xs opacity-30 select-none">·</span>
                )}
                <button
                    type="button"
                    aria-pressed={selected}
                    aria-disabled={dynamic || undefined}
                    title={dynamic ? "Dynamic title — running this row falls back to the whole file" : node.fullTitle}
                    className={
                        "suite-row text-xs " +
                        (node.kind === "describe" ? "font-semibold " : "") +
                        (node.pending ? "opacity-60 italic " : "") +
                        (dynamic ? "opacity-60 " : "")
                    }
                    onClick={() => {
                        if (dynamic) {
                            onSelect({ spec, node: null });
                            return;
                        }
                        onSelect({ spec, node: sel });
                    }}
                >
                    {node.kind === "it" ? "• " : ""}
                    {node.title}
                    {node.only ? " [only]" : ""}
                    {node.pending ? " [skip]" : ""}
                </button>
            </div>
            {node.kind === "describe" && open && node.children.length > 0 && (
                <ul className="space-y-0.5">
                    {node.children.map((c, i) => (
                        <NodeRow
                            key={`${c.kind}:${c.fullTitle}:${i}`}
                            node={c}
                            depth={depth + 1}
                            spec={spec}
                            isSelected={isSelected}
                            onSelect={onSelect}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}
