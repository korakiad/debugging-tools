import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseSuiteTree, mochaGrepFor, escapeRegex } from "../src/parseSuite.js";

function tmpSpec(content: string, ext = ".spec.js"): { dir: string; abs: string } {
    const dir = mkdtempSync(join(tmpdir(), "dbg-parse-"));
    const abs = join(dir, `sample${ext}`);
    writeFileSync(abs, content);
    return { dir, abs };
}

describe("parseSuiteTree", () => {
    it("captures top-level describe and its tests with full titles", () => {
        const { dir, abs } = tmpSpec(`
            describe('SauceDemo Login', function () {
                it('should enter username', function () {});
                it('should enter password', function () {});
            });
        `);
        const tree = parseSuiteTree(abs, { cwd: dir });
        expect(tree.source).toContain("describe('SauceDemo Login'");
        expect(tree.children).toHaveLength(1);
        const root = tree.children[0];
        expect(root.kind).toBe("describe");
        expect(root.title).toBe("SauceDemo Login");
        expect(root.fullTitle).toBe("SauceDemo Login");
        expect(root.endLine).toBeGreaterThan(root.line);
        expect(root.children).toHaveLength(2);
        expect(root.children[0].kind).toBe("it");
        expect(root.children[0].title).toBe("should enter username");
        expect(root.children[0].fullTitle).toBe("SauceDemo Login should enter username");
        expect(root.children[0].endLine).toBeGreaterThanOrEqual(root.children[0].line);
    });

    it("emits a line/endLine pair that slices the actual node body from source", () => {
        const { dir, abs } = tmpSpec(`describe('one', () => {
    it('alpha', () => { return 1; });
    it('beta', () => {
        const x = 2;
        return x;
    });
});
`);
        const tree = parseSuiteTree(abs, { cwd: dir });
        const lines = (tree.source ?? "").split(/\r?\n/);
        const beta = tree.children[0].children[1];
        const slice = lines.slice(beta.line - 1, beta.endLine).join("\n");
        expect(slice).toMatch(/it\('beta'/);
        expect(slice).toMatch(/return x/);
    });

    it("walks nested describes", () => {
        const { dir, abs } = tmpSpec(`
            describe('A', () => {
                describe('B', () => {
                    it('c', () => {});
                });
            });
        `);
        const tree = parseSuiteTree(abs, { cwd: dir });
        const a = tree.children[0];
        const b = a.children[0];
        const c = b.children[0];
        expect(b.fullTitle).toBe("A B");
        expect(c.fullTitle).toBe("A B c");
    });

    it("recognises context/specify aliases and skip/only/x* markers", () => {
        const { dir, abs } = tmpSpec(`
            context('outer', () => {
                specify('one', () => {});
                xit('skipped', () => {});
                it.only('focused', () => {});
                it.skip('skipped explicitly', () => {});
            });
            xdescribe('hidden', () => {});
        `);
        const tree = parseSuiteTree(abs, { cwd: dir });
        const ctx = tree.children[0];
        expect(ctx.kind).toBe("describe");
        expect(ctx.children.map((c) => c.kind)).toEqual(["it", "it", "it", "it"]);
        expect(ctx.children[1].pending).toBe(true);
        expect(ctx.children[2].only).toBe(true);
        expect(ctx.children[3].pending).toBe(true);
        const xd = tree.children[1];
        expect(xd.kind).toBe("describe");
        expect(xd.pending).toBe(true);
    });

    it("emits <dynamic> for template-literal titles with substitutions", () => {
        const { dir, abs } = tmpSpec(`
            const name = 'foo';
            describe(\`dyn-\${name}\`, () => {
                it('static', () => {});
            });
        `);
        const tree = parseSuiteTree(abs, { cwd: dir });
        expect(tree.children[0].title).toBe("<dynamic>");
        expect(tree.children[0].children[0].fullTitle).toContain("<dynamic>");
    });

    it("parses TypeScript files", () => {
        const { dir, abs } = tmpSpec(
            `
            describe('typed', (): void => {
                it('runs', async (): Promise<void> => {
                    const x: number = 1;
                });
            });
            `,
            ".spec.ts"
        );
        const tree = parseSuiteTree(abs, { cwd: dir });
        expect(tree.children[0].title).toBe("typed");
        expect(tree.children[0].children[0].title).toBe("runs");
    });

    it("returns an error tree for unreadable files instead of throwing", () => {
        const tree = parseSuiteTree("/no/such/file.spec.js", { cwd: "/" });
        expect(tree.error).toBeTruthy();
        expect(tree.children).toEqual([]);
    });

    it("does not pick up tests inside dynamic forEach loops (documented limitation)", () => {
        // The user can fall back to running the whole file. We don't synthesize
        // children we can't statically prove exist.
        const { dir, abs } = tmpSpec(`
            describe('outer', () => {
                ['a','b'].forEach((n) => {
                    it('runs ' + n, () => {});
                });
            });
        `);
        const tree = parseSuiteTree(abs, { cwd: dir });
        expect(tree.children[0].children).toEqual([]);
    });
});

describe("mochaGrepFor", () => {
    it("anchors and exact-matches an it node", () => {
        expect(mochaGrepFor({ kind: "it", fullTitle: "A B c" })).toBe("^A B c$");
    });

    it("matches every test under a describe via trailing-space prefix", () => {
        expect(mochaGrepFor({ kind: "describe", fullTitle: "A B" })).toBe("^A B ");
    });

    it("escapes regex metacharacters in titles so [test] doesn't become a class", () => {
        const out = mochaGrepFor({ kind: "it", fullTitle: "renders [foo] (baz) ?" });
        expect(out).toBe("^renders \\[foo\\] \\(baz\\) \\?$");
    });

    it("returns null when the title contains a dynamic marker", () => {
        expect(mochaGrepFor({ kind: "it", fullTitle: "x <dynamic> y" })).toBeNull();
        expect(mochaGrepFor({ kind: "describe", fullTitle: "<dynamic>" })).toBeNull();
    });
});

describe("escapeRegex", () => {
    it("escapes the regex metacharacter set", () => {
        expect(escapeRegex(".*+?^${}()|[]\\")).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
    });

    it("leaves plain text unchanged", () => {
        expect(escapeRegex("plain title")).toBe("plain title");
    });
});
