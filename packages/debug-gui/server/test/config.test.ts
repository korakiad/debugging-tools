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
            "debug-gui": { cdp: { port: 9222 } }
        }));

        const cfg = loadConfig(dir);

        expect(cfg.mocha.file).toEqual(["./hooks.js"]);
        expect(cfg.mocha.require).toBe("tsx");
        expect(cfg.cdp.port).toBe(9222);
    });

    it("applies defaults when debug-gui section missing", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}));

        const cfg = loadConfig(dir);

        expect(cfg.cdp.port).toBe(9222);
        expect(cfg.discovery.globs).toContain("test/**/*.spec.{js,ts}");
    });

    it("reads preRun from debug-gui section when set", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": { preRun: "npm run build" }
        }));
        const cfg = loadConfig(dir);
        expect(cfg.preRun).toBe("npm run build");
    });

    it("returns undefined preRun when missing", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}));
        const cfg = loadConfig(dir);
        expect(cfg.preRun).toBeUndefined();
    });

    it("returns undefined preRun when empty string", () => {
        // Empty string means "feature off" — saveConfig removes the key, but
        // defend in the loader too for old configs / partial writes.
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": { preRun: "" }
        }));
        const cfg = loadConfig(dir);
        expect(cfg.preRun).toBeUndefined();
    });
});

import { saveConfig } from "../src/config.js";
import { readFileSync } from "fs";

describe("saveConfig", () => {
    it("writes preRun into existing debug-gui block", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            name: "x",
            "debug-gui": { cdp: { port: 9222 } }
        }, null, 2));
        saveConfig(dir, { preRun: "npm run build" });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(written["debug-gui"].preRun).toBe("npm run build");
        expect(written["debug-gui"].cdp.port).toBe(9222); // preserved
        expect(written.name).toBe("x"); // preserved
    });

    it("creates debug-gui block when absent", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }, null, 2));
        saveConfig(dir, { preRun: "npm run build" });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(written["debug-gui"].preRun).toBe("npm run build");
    });

    it("removes preRun key when value is empty string", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": { preRun: "npm run build", cdp: { port: 9222 } }
        }, null, 2));
        saveConfig(dir, { preRun: "" });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect("preRun" in written["debug-gui"]).toBe(false);
        expect(written["debug-gui"].cdp.port).toBe(9222); // preserved
    });

    it("returns the freshly-loaded DebugGuiConfig", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}, null, 2));
        const cfg = saveConfig(dir, { preRun: "npm run build" });
        expect(cfg.preRun).toBe("npm run build");
    });
});
