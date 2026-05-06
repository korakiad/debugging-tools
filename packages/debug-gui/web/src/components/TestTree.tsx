import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, type SelectedNode } from "../state/store";
import { EfButton, EfTextField } from "../ui";
import { matchesQuery, parseTestTitle, type ParsedTitle } from "./parseTestTitle";

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
    // When true, all selectable rows (file, describe, it) become aria-disabled
    // no-ops. Used during the suite-switch "switching" phase so QA cannot
    // queue another selection while the cancel is in flight.
    disabled?: boolean;
    // Test seam: lets unit tests bypass /api/suite/tree.
    fetchTree?: (spec: string) => Promise<SuiteTree>;
}

async function defaultFetchTree(spec: string): Promise<SuiteTree> {
    const res = await fetch(`/api/suite/tree?spec=${encodeURIComponent(spec)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// Walks a node and decides whether the node itself or any descendant matches
// the (lowercased) needle. Used to (a) drop non-matching subtrees from the
// rendered list while a search is active, and (b) auto-expand files /
// describes that contain matches so QA does not have to chase carets.
function nodeMatchesRecursive(node: SuiteNode, needleLower: string, parsed?: ParsedTitle): boolean {
    if (!needleLower) return true;
    const p = parsed ?? parseTestTitle(node.title);
    if (matchesQuery(p, needleLower)) return true;
    if (node.fullTitle.toLowerCase().includes(needleLower)) return true;
    for (const c of node.children) {
        if (nodeMatchesRecursive(c, needleLower)) return true;
    }
    return false;
}

function countItNodes(nodes: SuiteNode[], needleLower: string, acc = { matched: 0, total: 0 }): { matched: number; total: number } {
    for (const n of nodes) {
        if (n.kind === "it") {
            acc.total += 1;
            if (!needleLower || nodeMatchesRecursive(n, needleLower)) acc.matched += 1;
        }
        if (n.children.length > 0) countItNodes(n.children, needleLower, acc);
    }
    return acc;
}

export function TestTree({
    suites,
    selection,
    onSelect,
    onOpenSettings,
    settingsDisabled,
    disabled,
    fetchTree,
}: TestTreeProps) {
    // Keyed by spec relPath. We lazy-load on first expansion so the parse
    // cost only hits files the user actually opens.
    const [trees, setTrees] = useState<Record<string, SuiteTree>>({});
    const [loading, setLoading] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [query, setQuery] = useState("");

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

    const ensureTree = useCallback(
        async (spec: string) => {
            if (trees[spec] || loading[spec] || errors[spec]) return;
            setLoading((m) => ({ ...m, [spec]: true }));
            try {
                const tree = await doFetch(spec);
                setTrees((m) => ({ ...m, [spec]: tree }));
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
        },
        [doFetch, trees, loading, errors],
    );

    const trimmedQuery = query.trim();
    const filterActive = trimmedQuery.length > 0;
    const needleLower = trimmedQuery.toLowerCase();

    // While a search is active, eagerly load every spec's tree (debounced)
    // so the filter can match across files the user has not opened yet.
    // Without this, hidden subtrees would silently be excluded from results.
    const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!filterActive) {
            if (fetchTimer.current) {
                clearTimeout(fetchTimer.current);
                fetchTimer.current = null;
            }
            return;
        }
        if (fetchTimer.current) clearTimeout(fetchTimer.current);
        fetchTimer.current = setTimeout(() => {
            for (const s of suites) void ensureTree(s.relPath);
        }, 250);
        return () => {
            if (fetchTimer.current) {
                clearTimeout(fetchTimer.current);
                fetchTimer.current = null;
            }
        };
    }, [filterActive, suites, ensureTree]);

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

    // Aggregate "N of M tests match" — only counts loaded trees; files still
    // loading are skipped so the number does not jitter as fetches resolve.
    const counts = useMemo(() => {
        const acc = { matched: 0, total: 0 };
        for (const s of suites) {
            const t = trees[s.relPath];
            if (!t || t.error) continue;
            countItNodes(t.children, needleLower, acc);
        }
        return acc;
    }, [suites, trees, needleLower]);

    return (
        <nav aria-label="test suites" className="test-tree-panel w-80 h-full overflow-auto flex flex-col">
            <h2 className="test-tree-panel-header">Test Suites</h2>
            <div className="tree-search-bar">
                <EfTextField
                    aria-label="filter test suites"
                    placeholder="Filter suites, tests, tags…"
                    value={query}
                    onValueChanged={(e) =>
                        setQuery((e as CustomEvent<{ value: string }>).detail.value ?? "")
                    }
                    disabled={disabled || undefined}
                />
                {filterActive && (
                    <button
                        type="button"
                        className="tree-search-clear"
                        aria-label="clear filter"
                        onClick={() => setQuery("")}
                    >
                        ✕
                    </button>
                )}
            </div>
            {filterActive && (
                <div className="tree-search-meta" aria-live="polite">
                    {counts.matched} of {counts.total} tests match
                </div>
            )}
            {suites.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm">
                    <p className="opacity-70 mb-1">Looks like there are no test files yet.</p>
                    <p className="opacity-60 text-xs mb-3">
                        Configure where to find them in Settings.
                    </p>
                    {onOpenSettings && (
                        <EfButton
                            onClick={onOpenSettings}
                            disabled={settingsDisabled || undefined}
                        >
                            Open Settings ⚙
                        </EfButton>
                    )}
                </div>
            ) : (
                <ul className="flex-1">
                    {suites.map((s) => {
                        const tree = trees[s.relPath];
                        const fileSelected = isSelected(s.relPath, null);
                        const pathMatches =
                            !filterActive || s.relPath.toLowerCase().includes(needleLower);
                        const childMatches =
                            filterActive && !!tree && !tree.error
                                ? tree.children.some((c) => nodeMatchesRecursive(c, needleLower))
                                : false;
                        // While filtering, hide files whose path does not match
                        // and whose loaded tree contains nothing matching. Files
                        // still loading stay visible (with a Loading… hint) so
                        // users see the search is working.
                        if (filterActive && !pathMatches && !childMatches && !loading[s.relPath]) {
                            return null;
                        }
                        // Auto-expand on filter when this file participates in
                        // results, but do not persist that into the manual
                        // expanded-state map.
                        const userExpanded = !!expanded[s.relPath];
                        const isOpen =
                            userExpanded ||
                            (filterActive && (pathMatches || childMatches));
                        // If the path itself matched, show every child (even
                        // ones that don't match the needle) — a file-name match
                        // is a directive to look at the whole file.
                        const childNeedle = filterActive && pathMatches && !childMatches ? "" : needleLower;
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
                                        className={
                                            "suite-row" +
                                            (disabled ? " opacity-50 pointer-events-none" : "")
                                        }
                                        aria-pressed={fileSelected}
                                        aria-disabled={disabled || undefined}
                                        tabIndex={disabled ? -1 : undefined}
                                        title={s.relPath}
                                        onClick={() => {
                                            if (disabled) return;
                                            onSelect({ spec: s.relPath, node: null });
                                        }}
                                    >
                                        <span className="suite-row-text">{s.relPath}</span>
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
                                                        disabled={disabled}
                                                        needleLower={childNeedle}
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
    disabled,
    needleLower,
}: {
    node: SuiteNode;
    depth: number;
    spec: string;
    isSelected: (spec: string, node: SelectedNode | null) => boolean;
    onSelect: (sel: TestSelection) => void;
    disabled?: boolean;
    needleLower: string;
}) {
    // describe blocks are open by default — most QA suites are 1-2 levels
    // deep, so chasing carets adds friction with no payoff.
    const [open, setOpen] = useState(true);
    const sel: SelectedNode = { kind: node.kind, fullTitle: node.fullTitle };
    const dynamic = node.title === "<dynamic>" || node.title === "<missing>";
    const selected = isSelected(spec, sel);
    const parsed = useMemo(() => parseTestTitle(node.title), [node.title]);

    const filterActive = needleLower.length > 0;
    if (filterActive && !nodeMatchesRecursive(node, needleLower, parsed)) {
        return null;
    }
    // While filtering, force describes open so matched leaves are visible.
    const effectiveOpen = open || filterActive;

    const tagSummary = parsed.tags.join(" · ");
    // The label's hover-tooltip shows the full raw title (including stripped
    // tags) so QA can still see the structured metadata when they need it.
    const tooltip = dynamic
        ? "Dynamic title — running this row falls back to the whole file"
        : parsed.raw;

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
                        aria-label={effectiveOpen ? `collapse ${parsed.displayTitle}` : `expand ${parsed.displayTitle}`}
                        aria-expanded={effectiveOpen}
                        className="suite-toggle text-xs opacity-70 hover:opacity-100"
                        onClick={() => setOpen((v) => !v)}
                    >
                        {effectiveOpen ? "▾" : "▸"}
                    </button>
                ) : (
                    <span className="suite-toggle text-xs opacity-30 select-none">·</span>
                )}
                <button
                    type="button"
                    aria-pressed={selected}
                    aria-disabled={dynamic || disabled || undefined}
                    tabIndex={disabled ? -1 : undefined}
                    title={tooltip}
                    className={
                        "suite-row " +
                        (node.kind === "describe" ? "font-semibold " : "") +
                        (node.pending ? "opacity-60 italic " : "") +
                        (dynamic ? "opacity-60 " : "") +
                        (disabled ? "opacity-50 pointer-events-none " : "")
                    }
                    onClick={() => {
                        if (disabled) return;
                        if (dynamic) {
                            onSelect({ spec, node: null });
                            return;
                        }
                        onSelect({ spec, node: sel });
                    }}
                >
                    {parsed.caseId && !dynamic && (
                        <span className="suite-caseid-chip" aria-hidden="true">
                            {parsed.caseId}
                        </span>
                    )}
                    <span className="suite-row-text">
                        {node.kind === "it" ? "• " : ""}
                        {parsed.displayTitle}
                    </span>
                    {node.only && <span className="suite-flag-only">only</span>}
                    {node.pending && <span className="suite-flag-skip">skip</span>}
                    {parsed.tags.length > 0 && (
                        <span
                            className="suite-tag-chip-count"
                            title={tagSummary}
                            aria-label={`${parsed.tags.length} tag${parsed.tags.length === 1 ? "" : "s"}: ${tagSummary}`}
                        >
                            +{parsed.tags.length}
                        </span>
                    )}
                </button>
            </div>
            {node.kind === "describe" && effectiveOpen && node.children.length > 0 && (
                <ul className="space-y-0.5">
                    {node.children.map((c, i) => (
                        <NodeRow
                            key={`${c.kind}:${c.fullTitle}:${i}`}
                            node={c}
                            depth={depth + 1}
                            spec={spec}
                            isSelected={isSelected}
                            onSelect={onSelect}
                            disabled={disabled}
                            needleLower={needleLower}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}
