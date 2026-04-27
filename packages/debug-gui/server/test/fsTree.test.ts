import { describe, it, expect } from "vitest";
import { listProjectTree } from "../src/fsTree.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function scaffold() {
    const dir = mkdtempSync(join(tmpdir(), "dbg-fs-"));
    mkdirSync(join(dir, "test"), { recursive: true });
    mkdirSync(join(dir, "test/ui"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "node_modules/some-pkg"), { recursive: true });
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, "test/login.spec.js"), "");
    writeFileSync(join(dir, "test/cart.spec.js"), "");
    writeFileSync(join(dir, "test/ui/button.spec.ts"), "");
    writeFileSync(join(dir, "test/notes.txt"), "");
    writeFileSync(join(dir, "src/app.js"), "");
    writeFileSync(join(dir, "node_modules/some-pkg/a.spec.js"), "");
    writeFileSync(join(dir, ".git/ignored.spec.js"), "");
    return dir;
}

describe("listProjectTree", () => {
    it("returns only files matching fileFilter", () => {
        const dir = scaffold();
        const tree = listProjectTree(dir, { fileFilter: /\.spec\.(js|ts)$/ });
        const paths = flatten(tree).filter((n) => !n.isDir).map((n) => n.path).sort();
        expect(paths).toEqual([
            "test/cart.spec.js",
            "test/login.spec.js",
            "test/ui/button.spec.ts",
        ]);
    });

    it("skips node_modules, .git, and dotfiles", () => {
        const dir = scaffold();
        const tree = listProjectTree(dir, { fileFilter: /\.spec\.js$/ });
        const all = flatten(tree).map((n) => n.path);
        expect(all.some((p) => p.startsWith("node_modules"))).toBe(false);
        expect(all.some((p) => p.startsWith(".git"))).toBe(false);
    });

    it("omits empty directories (those with no matching descendants)", () => {
        const dir = scaffold();
        const tree = listProjectTree(dir, { fileFilter: /\.spec\.(js|ts)$/ });
        // src/ has no spec files → should not appear as a branch.
        const topChildren = (tree.children ?? []).map((n) => n.name);
        expect(topChildren).not.toContain("src");
    });
});

function flatten(node: { path: string; isDir: boolean; children?: any[] }): Array<{ path: string; isDir: boolean }> {
    const out: Array<{ path: string; isDir: boolean }> = [{ path: node.path, isDir: node.isDir }];
    for (const c of node.children ?? []) out.push(...flatten(c));
    return out;
}
