import { describe, it, expect } from "vitest";
import { makeEditFileTool } from "../../src/tools/editFile.js";
import { writeFileSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("edit_file override", () => {
    it("writes file when approved (full-file rewrite)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "edit-"));
        const file = join(dir, "a.js");
        writeFileSync(file, "old");
        const tool = makeEditFileTool({
            onPropose: async () => ({ approved: true }),
        });
        const result = await (tool as any).handler({ path: file, oldContent: "old", newContent: "new" }, {});
        expect(result.applied).toBe(true);
        expect(readFileSync(file, "utf8")).toBe("new");
    });

    it("returns rejection when denied", async () => {
        const dir = mkdtempSync(join(tmpdir(), "edit-"));
        const file = join(dir, "a.js");
        writeFileSync(file, "old");
        const tool = makeEditFileTool({
            onPropose: async () => ({ approved: false, reason: "wrong" }),
        });
        const result = await (tool as any).handler({ path: file, oldContent: "old", newContent: "new" }, {});
        expect(result.applied).toBe(false);
        expect(result.rejection).toBe("wrong");
        expect(readFileSync(file, "utf8")).toBe("old");
    });

    // Edit-style: oldContent is a unique substring of the file (not the
    // whole file). The tool should replace just that substring in place
    // and write the resulting full file back, preserving every other line.
    it("replaces a unique substring in place (edit-style)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "edit-"));
        const file = join(dir, "login.page.js");
        const original = [
            "class LoginPage {",
            "    get usernameField() { return '#username'; }",
            "    get passwordField() { return 'input.password-field'; }",
            "    get loginButton() { return '[data-test=\"submit-btn\"]'; }",
            "}",
            "",
            "module.exports = { LoginPage };",
            "",
        ].join("\n");
        writeFileSync(file, original);
        const tool = makeEditFileTool({
            onPropose: async () => ({ approved: true }),
        });
        const result = await (tool as any).handler(
            {
                path: file,
                oldContent: "    get usernameField() { return '#username'; }",
                newContent: "    get usernameField() { return '#user-name'; }",
            },
            {},
        );
        expect(result.applied).toBe(true);
        const after = readFileSync(file, "utf8");
        // Unchanged lines must still be there — the bug was that they got
        // truncated when writeFile(path, newContent) blew away the file.
        expect(after).toContain("class LoginPage {");
        expect(after).toContain("get passwordField()");
        expect(after).toContain("get loginButton()");
        expect(after).toContain("module.exports = { LoginPage };");
        // The targeted line was actually changed.
        expect(after).toContain("get usernameField() { return '#user-name'; }");
        expect(after).not.toContain("'#username'");
    });

    // Reproduces the destructive bug from the screenshot: the agent passed
    // the entire file as oldContent and only a 4-line snippet as newContent.
    // The old behavior would truncate the file to those 4 lines. The fix
    // refuses to apply such a change.
    it("rejects a full-file rewrite that would catastrophically truncate", async () => {
        const dir = mkdtempSync(join(tmpdir(), "edit-"));
        const file = join(dir, "login.page.js");
        const original = Array.from({ length: 23 }, (_, i) => `// line ${i + 1}`).join("\n");
        writeFileSync(file, original);
        const tool = makeEditFileTool({
            onPropose: async () => ({ approved: true }),
        });
        const result = await (tool as any).handler(
            {
                path: file,
                oldContent: original,
                newContent: [
                    "// FIXED",
                    "get usernameField() {",
                    "    return '#user-name';",
                    "}",
                ].join("\n"),
            },
            {},
        );
        expect(result.applied).toBe(false);
        expect(result.rejection ?? "").toMatch(/truncat|substring/i);
        // Crucially, the file is unchanged.
        expect(readFileSync(file, "utf8")).toBe(original);
    });

    it("rejects when oldContent is not found in the file", async () => {
        const dir = mkdtempSync(join(tmpdir(), "edit-"));
        const file = join(dir, "a.js");
        writeFileSync(file, "alpha\nbeta\ngamma\n");
        const tool = makeEditFileTool({
            onPropose: async () => ({ approved: true }),
        });
        const result = await (tool as any).handler(
            { path: file, oldContent: "delta", newContent: "epsilon" },
            {},
        );
        expect(result.applied).toBe(false);
        expect(result.rejection ?? "").toMatch(/not found|substring/i);
        expect(readFileSync(file, "utf8")).toBe("alpha\nbeta\ngamma\n");
    });

    it("rejects when oldContent matches multiple places (ambiguous)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "edit-"));
        const file = join(dir, "a.js");
        writeFileSync(file, "x = 1\ny = 1\nz = 1\n");
        const tool = makeEditFileTool({
            onPropose: async () => ({ approved: true }),
        });
        const result = await (tool as any).handler(
            { path: file, oldContent: "= 1", newContent: "= 2" },
            {},
        );
        expect(result.applied).toBe(false);
        expect(result.rejection ?? "").toMatch(/multiple|unique|ambig/i);
        expect(readFileSync(file, "utf8")).toBe("x = 1\ny = 1\nz = 1\n");
    });

    // The diff payload broadcast to the UI should reflect what will
    // actually happen on disk — the FULL file before and the FULL file
    // after — not the agent's raw snippet. That way DiffView's
    // parseDiffFromFile shows a minimal diff focused on the changed
    // lines, with all surrounding context intact.
    it("passes full before/after file content to onPropose", async () => {
        const dir = mkdtempSync(join(tmpdir(), "edit-"));
        const file = join(dir, "a.js");
        const before = "alpha\nbeta\ngamma\n";
        const after = "alpha\nBETA\ngamma\n";
        writeFileSync(file, before);
        const seen: { oldCode: string; newCode: string } = { oldCode: "", newCode: "" };
        const tool = makeEditFileTool({
            onPropose: async (_file, oldCode, newCode) => {
                seen.oldCode = oldCode;
                seen.newCode = newCode;
                return { approved: true };
            },
        });
        await (tool as any).handler(
            { path: file, oldContent: "beta", newContent: "BETA" },
            {},
        );
        expect(seen.oldCode).toBe(before);
        expect(seen.newCode).toBe(after);
    });
});
