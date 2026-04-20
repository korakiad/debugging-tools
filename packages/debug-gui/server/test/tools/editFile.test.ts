import { describe, it, expect } from "vitest";
import { makeEditFileTool } from "../../src/tools/editFile.js";
import { writeFileSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("edit_file override", () => {
    it("writes file when approved", async () => {
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
});
