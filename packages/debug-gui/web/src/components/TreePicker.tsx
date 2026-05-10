import { useEffect, useRef, useState } from "react";
import { EfButton, EfDialog, EfTree } from "../ui";
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
    fetchTree?: (filter: string | null) => Promise<{ root: FsTreeNode; truncated?: boolean }>;
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
    const [truncated, setTruncated] = useState(false);
    const treeRef = useRef<HTMLElement | null>(null);

    const filter = buildFilterFromExtensions(extensions ?? []);
    useEffect(() => {
        if (!open) return;
        const doFetch = fetchTree ?? defaultFetchTree;
        setLoading(true);
        setError(null);
        setTruncated(false);
        doFetch(filter)
            .then((res) => {
                setData(toTreeData(res.root));
                setTruncated(!!res.truncated);
            })
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
        <EfDialog
            opened
            header="Pick test files or folders"
            // Mirror SettingsDialog: ef-dialog renders the header inside an
            // ef-header but doesn't aria-labelledby the host, so spell out
            // the accessible name for `getByRole("dialog")` lookups.
            aria-label="pick-test-files"
            style={{ width: "640px", maxHeight: "85vh" }}
            onCancel={onCancel}
            onOpenedChanged={(e) => {
                const opened = (e as CustomEvent<{ value: boolean }>).detail.value;
                if (!opened) onCancel();
            }}
        >
            <div className="text-sm space-y-3 p-1">
                <p className="opacity-70 text-xs">
                    Tick folders to include their test files, or individual files.
                    Saving replaces the current discovery globs.
                </p>

                {loading && <p className="opacity-70">Loading project tree…</p>}
                {error && (
                    <div>
                        <p className="text-red-400 text-sm">Failed to load tree: {error}</p>
                        <p className="opacity-60 text-xs mt-1">
                            Close this and try again, or add globs by hand.
                        </p>
                    </div>
                )}

                {!loading && !error && truncated && (
                    <div
                        role="alert"
                        className="text-xs px-3 py-2 rounded"
                        style={{
                            background: "var(--ef-color-warning-200, #4a3a14)",
                            border: "1px solid var(--ef-color-warning-500, #c08a2c)",
                            color: "var(--ef-color-warning-100, #f0d090)",
                        }}
                    >
                        Project tree was truncated at the entry cap. Some files
                        are not shown — narrow the extensions or pick a more
                        specific folder to see the rest.
                    </div>
                )}

                {!loading && !error && (
                    <div
                        className="max-h-[50vh] overflow-auto p-2"
                        style={{ border: "1px solid var(--ef-border-color, #404040)" }}
                    >
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
            </div>

            <div slot="footer" className="flex justify-end gap-2">
                <EfButton onClick={onCancel}>Cancel</EfButton>
                <EfButton
                    cta
                    onClick={handleUse}
                    disabled={loading || !!error || undefined}
                >
                    Use these
                </EfButton>
            </div>
        </EfDialog>
    );
}

async function defaultFetchTree(filter: string | null): Promise<{ root: FsTreeNode; truncated?: boolean }> {
    const url = filter ? `/api/fs/tree?filter=${encodeURIComponent(filter)}` : "/api/fs/tree";
    const res = await fetch(url);
    if (!res.ok) {
        // Server's defensive catch returns {error: "..."} JSON. Surface it
        // verbatim so the dialog shows the actual cause instead of
        // "HTTP 500" with no context.
        let detail = "";
        try {
            const body = await res.json();
            if (body?.error) detail = `: ${body.error}`;
        } catch {
            /* non-JSON body — keep bare status */
        }
        throw new Error(`HTTP ${res.status}${detail}`);
    }
    return res.json();
}
