import { useEffect, useRef, useState } from "react";
import { EfTree } from "../ui";
import type { TreeSelection } from "../lib/projection";

export interface FsTreeNode {
    name: string;
    path: string;
    isDir: boolean;
    children?: FsTreeNode[];
}

export interface TreeDataItem {
    label: string;
    value: string;
    items?: TreeDataItem[];
    expanded?: boolean;
    selected?: boolean;
}

export interface TreePickerProps {
    open: boolean;
    // Empty / undefined → use server default filter.
    extensions?: string[];
    // Prefer fetch() wrapper so tests can stub it without MSW.
    fetchTree?: (filter: string | null) => Promise<{ root: FsTreeNode }>;
    onPick: (selection: TreeSelection) => void;
    onCancel: () => void;
}

// Build a fileFilter regex suitable for the /api/fs/tree endpoint from a
// user's extension list. Escape is unnecessary for typical ext chars.
export function buildFilterFromExtensions(exts: string[]): string | null {
    const clean = exts.map((e) => e.replace(/^\./, "")).filter(Boolean);
    if (clean.length === 0) return null;
    return `\\.(spec|test)\\.(${clean.join("|")})$`;
}

// Convert the server's FsTreeNode into ef-tree's TreeDataItem shape.
// Encodes path + kind in `value` so we can recover both when resolving
// the user's selection. Top-level folders come back expanded once — it's
// the least click-heavy first impression for a QA tester.
export function toTreeData(root: FsTreeNode): TreeDataItem[] {
    const visit = (n: FsTreeNode, depth: number): TreeDataItem => ({
        label: n.name,
        value: `${n.isDir ? "d" : "f"}:${n.path}`,
        expanded: n.isDir && depth <= 1,
        items: n.isDir ? (n.children ?? []).map((c) => visit(c, depth + 1)) : undefined,
    });
    return (root.children ?? []).map((c) => visit(c, 1));
}

// Split the set of ticked `value` strings back into { dirs, files }.
export function resolveSelection(values: string[]): TreeSelection {
    const dirs: string[] = [];
    const files: string[] = [];
    for (const v of values) {
        if (v.startsWith("d:")) dirs.push(v.slice(2));
        else if (v.startsWith("f:")) files.push(v.slice(2));
    }
    return { dirs, files };
}

export function TreePicker({ open, extensions, fetchTree, onPick, onCancel }: TreePickerProps) {
    const [data, setData] = useState<TreeDataItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const treeRef = useRef<HTMLElement | null>(null);

    const filter = buildFilterFromExtensions(extensions ?? []);
    useEffect(() => {
        if (!open) return;
        const doFetch = fetchTree ?? defaultFetchTree;
        setLoading(true);
        setError(null);
        doFetch(filter)
            .then((res) => setData(toTreeData(res.root)))
            .catch((e) => setError(e?.message ?? String(e)))
            .finally(() => setLoading(false));
        // filter derives from `extensions`; adding it covers reopen-with-new-filter.
    }, [open, fetchTree, filter]);

    // Push data into the ef-tree imperatively — the element reads `.data` as
    // a property, not an attribute, so React's prop pass-through won't work.
    useEffect(() => {
        if (treeRef.current) {
            (treeRef.current as any).data = data;
        }
    }, [data]);

    if (!open) return null;

    const handleUse = () => {
        const el = treeRef.current as any;
        // `.values` returns the selected-item value list in refinitiv-ui Tree.
        const values: string[] = Array.isArray(el?.values) ? el.values : [];
        onPick(resolveSelection(values));
    };

    return (
        <div
            role="dialog"
            aria-label="pick-test-files"
            aria-modal="true"
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
            onClick={onCancel}
        >
            <div
                className="bg-neutral-900 border border-gray-700 rounded shadow-xl p-4 w-[640px] max-h-[85vh] overflow-auto text-sm"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-base font-semibold mb-2">Pick test files or folders</h3>
                <p className="opacity-70 text-xs mb-3">
                    Tick folders to include their test files, or individual files.
                    Saving replaces the current discovery globs.
                </p>

                {loading && <p className="opacity-70">Loading project tree…</p>}
                {error && <p className="text-red-400">Failed to load tree: {error}</p>}

                {!loading && !error && (
                    <div className="max-h-[50vh] overflow-auto border border-gray-700 rounded p-2 mb-3">
                        {data.length === 0 ? (
                            <div className="px-2 py-6 text-center text-sm">
                                <p className="opacity-70 mb-1">No files matched.</p>
                                <p className="opacity-60 text-xs">
                                    Try widening the extensions, or pick a different folder.
                                </p>
                            </div>
                        ) : (
                            <EfTree ref={treeRef as any} multiple />
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-3 py-1 rounded border border-gray-600"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleUse}
                        disabled={loading || !!error}
                        className="px-3 py-1 rounded border border-gray-600 disabled:opacity-40"
                    >
                        Use these
                    </button>
                </div>
            </div>
        </div>
    );
}

async function defaultFetchTree(filter: string | null): Promise<{ root: FsTreeNode }> {
    const url = filter ? `/api/fs/tree?filter=${encodeURIComponent(filter)}` : "/api/fs/tree";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}
