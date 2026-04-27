import { describe, it, expect } from "vitest";
import { toTreeData, resolveSelection, buildFilterFromExtensions, type FsTreeNode } from "./TreePicker";

describe("toTreeData", () => {
    it("encodes kind+path into value and drops the synthetic root", () => {
        const root: FsTreeNode = {
            name: "proj",
            path: "",
            isDir: true,
            children: [
                {
                    name: "test",
                    path: "test",
                    isDir: true,
                    children: [
                        { name: "login.spec.js", path: "test/login.spec.js", isDir: false },
                    ],
                },
            ],
        };
        const out = toTreeData(root);
        expect(out).toHaveLength(1);
        expect(out[0].value).toBe("d:test");
        expect(out[0].items![0].value).toBe("f:test/login.spec.js");
    });

    it("expands top-level dirs by default, leaves deeper dirs collapsed", () => {
        const root: FsTreeNode = {
            name: "proj",
            path: "",
            isDir: true,
            children: [
                {
                    name: "test",
                    path: "test",
                    isDir: true,
                    children: [
                        { name: "ui", path: "test/ui", isDir: true, children: [
                            { name: "btn.spec.js", path: "test/ui/btn.spec.js", isDir: false },
                        ]},
                    ],
                },
            ],
        };
        const out = toTreeData(root);
        expect(out[0].expanded).toBe(true);
        expect(out[0].items![0].expanded).toBe(false);
    });

    it("leaves the items array empty (not undefined) for dirs with no children", () => {
        const root: FsTreeNode = {
            name: "proj",
            path: "",
            isDir: true,
            children: [{ name: "empty", path: "empty", isDir: true, children: [] }],
        };
        const out = toTreeData(root);
        expect(out[0].items).toEqual([]);
    });
});

describe("buildFilterFromExtensions", () => {
    it("returns null for empty input (server uses default)", () => {
        expect(buildFilterFromExtensions([])).toBeNull();
    });
    it("builds a regex constrained to the given extensions", () => {
        expect(buildFilterFromExtensions(["js", "ts"])).toBe("\\.(spec|test)\\.(js|ts)$");
    });
    it("strips leading dots", () => {
        expect(buildFilterFromExtensions([".js"])).toBe("\\.(spec|test)\\.(js)$");
    });
    it("is a valid regex the server can parse", () => {
        const out = buildFilterFromExtensions(["js", "ts"]);
        // new RegExp throws if invalid — this test fails loudly if it does.
        const re = new RegExp(out!);
        expect(re.test("login.spec.js")).toBe(true);
        expect(re.test("login.spec.tsx")).toBe(false);
    });
});

describe("resolveSelection", () => {
    it("splits values by kind prefix", () => {
        const sel = resolveSelection(["d:test", "f:test/login.spec.js", "d:spec"]);
        expect(sel.dirs.sort()).toEqual(["spec", "test"]);
        expect(sel.files).toEqual(["test/login.spec.js"]);
    });

    it("ignores unknown prefixes defensively", () => {
        const sel = resolveSelection(["x:weird", "d:ok"]);
        expect(sel.dirs).toEqual(["ok"]);
        expect(sel.files).toEqual([]);
    });

    it("handles empty array", () => {
        expect(resolveSelection([])).toEqual({ dirs: [], files: [] });
    });
});
