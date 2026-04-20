import { describe, it, expect } from "vitest";
import { discoverSuites } from "../src/discovery.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("discoverSuites", () => {
    it("finds specs matching globs and respects exclude", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        mkdirSync(join(dir, "test"), { recursive: true });
        mkdirSync(join(dir, "test/playwright"), { recursive: true });
        writeFileSync(join(dir, "test/login.spec.js"), "");
        writeFileSync(join(dir, "test/cart.spec.js"), "");
        writeFileSync(join(dir, "test/playwright/foo.spec.js"), "");

        const suites = discoverSuites(dir, {
            globs: ["test/**/*.spec.{js,ts}"],
            exclude: ["test/playwright/**"],
        });

        const names = suites.map((s) => s.relPath).sort();
        expect(names).toEqual(["test/cart.spec.js", "test/login.spec.js"]);
    });
});
