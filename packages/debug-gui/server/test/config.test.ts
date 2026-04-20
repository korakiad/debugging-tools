import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("loadConfig", () => {
    it("reads mocha + debug-gui sections from package.json", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            mocha: { file: ["./hooks.js"], require: "tsx", exclude: ["dist/**"] },
            "debug-gui": { cdp: { port: 9222 }, walkthroughPort: 3456 }
        }));

        const cfg = loadConfig(dir);

        expect(cfg.mocha.file).toEqual(["./hooks.js"]);
        expect(cfg.mocha.require).toBe("tsx");
        expect(cfg.cdp.port).toBe(9222);
        expect(cfg.walkthroughPort).toBe(3456);
    });

    it("applies defaults when debug-gui section missing", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}));

        const cfg = loadConfig(dir);

        expect(cfg.cdp.port).toBe(9222);
        expect(cfg.walkthroughPort).toBe(3456);
        expect(cfg.discovery.globs).toContain("test/**/*.spec.{js,ts}");
    });
});
