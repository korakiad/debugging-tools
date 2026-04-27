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

export function listProjectTree(root: string, opts: ListOptions = {}): FsTreeNode {
    const ignore = new Set([...ALWAYS_IGNORE, ...(opts.ignoreDirs ?? [])]);
    const cap = opts.maxEntries ?? 5000;
    const counter = { n: 0 };

    const walk = (absDir: string, relDir: string): FsTreeNode | null => {
        if (counter.n >= cap) return null;
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
            if (counter.n >= cap) break;
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
                counter.n++;
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

    return walk(root, "") ?? { name: path.basename(root), path: "", isDir: true, children: [] };
}
