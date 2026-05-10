import { readdirSync } from "fs";
import path from "path";

export interface FsTreeNode {
    name: string;
    path: string;
    isDir: boolean;
    children?: FsTreeNode[];
}

// Directories we never descend into — they'd explode the payload and
// the user doesn't write tests inside node_modules/ anyway.
const ALWAYS_IGNORE = new Set([
    "node_modules",
    ".git",
    ".worktrees",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".turbo",
    ".vite",
]);

export interface ListOptions {
    // Only include files whose basename matches this regex. Directories are
    // always included if any descendant matches.
    fileFilter?: RegExp;
    // Extra directory names to skip (merged with ALWAYS_IGNORE).
    ignoreDirs?: string[];
    // Safety cap — stop walking if we exceed this count.
    maxEntries?: number;
}

export interface FsTreeResult {
    root: FsTreeNode;
    // True when the walk hit `maxEntries` and stopped early. The returned
    // tree is partial; callers MUST surface this to the user (e.g. a banner
    // in the TreePicker dialog) so they don't pick from a tree that silently
    // missed files.
    truncated: boolean;
}

export function listProjectTree(root: string, opts: ListOptions = {}): FsTreeResult {
    const ignore = new Set([...ALWAYS_IGNORE, ...(opts.ignoreDirs ?? [])]);
    const cap = opts.maxEntries ?? 5000;
    const state = { n: 0, truncated: false };

    const walk = (absDir: string, relDir: string): FsTreeNode | null => {
        if (state.n >= cap) {
            state.truncated = true;
            return null;
        }
        let entries;
        try {
            entries = readdirSync(absDir, { withFileTypes: true });
        } catch {
            return null;
        }
        entries.sort((a, b) => {
            // directories first, then alpha
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        const children: FsTreeNode[] = [];
        for (const ent of entries) {
            if (state.n >= cap) {
                state.truncated = true;
                break;
            }
            if (ent.name.startsWith(".") && ent.name !== ".") continue;
            const entRel = relDir ? `${relDir}/${ent.name}` : ent.name;
            if (ent.isDirectory()) {
                if (ignore.has(ent.name)) continue;
                const sub = walk(path.join(absDir, ent.name), entRel);
                if (sub && sub.children && sub.children.length > 0) {
                    children.push(sub);
                }
            } else if (ent.isFile()) {
                if (opts.fileFilter && !opts.fileFilter.test(ent.name)) continue;
                state.n++;
                children.push({
                    name: ent.name,
                    path: entRel,
                    isDir: false,
                });
            }
        }
        return {
            name: relDir === "" ? path.basename(absDir) : path.basename(relDir),
            path: relDir,
            isDir: true,
            children,
        };
    };

    const node = walk(root, "") ?? { name: path.basename(root), path: "", isDir: true, children: [] };
    return { root: node, truncated: state.truncated };
}
