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

    it("reads discovery.globs and discovery.exclude from debug-gui block", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": {
                discovery: {
                    globs: ["e2e/**/*.spec.ts"],
                    exclude: ["e2e/skip/**"],
                },
            },
        }));
        const cfg = loadConfig(dir);
        expect(cfg.discovery.globs).toEqual(["e2e/**/*.spec.ts"]);
        expect(cfg.discovery.exclude).toEqual(["e2e/skip/**"]);
    });

    it("migrates legacy mocha.exclude into discovery.exclude when debug-gui.discovery.exclude missing", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            mocha: { exclude: ["dist/**", "build/**"] },
            "debug-gui": { discovery: { globs: ["test/**/*.spec.js"] } },
        }));
        const cfg = loadConfig(dir);
        expect(cfg.discovery.exclude).toEqual(["dist/**", "build/**"]);
    });

    it("prefers debug-gui.discovery.exclude over legacy mocha.exclude when both present", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            mocha: { exclude: ["dist/**"] },
            "debug-gui": { discovery: { exclude: ["node_modules/**"] } },
        }));
        const cfg = loadConfig(dir);
        expect(cfg.discovery.exclude).toEqual(["node_modules/**"]);
    });

    it("defaults discovery.exclude to empty array when neither source present", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}));
        const cfg = loadConfig(dir);
        expect(cfg.discovery.exclude).toEqual([]);
    });

    it("reads agent.idleTimeoutMs when set, defaults to 10 minutes", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": { agent: { idleTimeoutMs: 120000 } },
        }));
        expect(loadConfig(dir).agent.idleTimeoutMs).toBe(120000);

        const dir2 = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir2, "package.json"), JSON.stringify({}));
        expect(loadConfig(dir2).agent.idleTimeoutMs).toBe(10 * 60 * 1000);
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

    it("writes idleTimeoutMs into debug-gui.agent block", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": { agent: { idleTimeoutMs: 600000 } },
        }, null, 2));
        saveConfig(dir, { idleTimeoutMs: 120000 });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(written["debug-gui"].agent.idleTimeoutMs).toBe(120000);
    });

    it("writes discovery.globs and discovery.exclude into debug-gui block", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}, null, 2));
        saveConfig(dir, {
            discovery: { globs: ["e2e/**/*.spec.ts"], exclude: ["fixtures/**"] },
        });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(written["debug-gui"].discovery.globs).toEqual(["e2e/**/*.spec.ts"]);
        expect(written["debug-gui"].discovery.exclude).toEqual(["fixtures/**"]);
    });

    it("updates only the discovery fields provided in the patch", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": {
                discovery: { globs: ["old/**"], exclude: ["keep/**"] },
            },
        }, null, 2));
        saveConfig(dir, { discovery: { globs: ["new/**"] } });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(written["debug-gui"].discovery.globs).toEqual(["new/**"]);
        expect(written["debug-gui"].discovery.exclude).toEqual(["keep/**"]);
    });

    it("writes discovery.extensions and reads it back", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}, null, 2));
        const cfg = saveConfig(dir, { discovery: { extensions: ["js", "ts", "tsx"] } });
        expect(cfg.discovery.extensions).toEqual(["js", "ts", "tsx"]);
    });

    it("removes discovery.extensions when patched with empty array", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({
            "debug-gui": { discovery: { extensions: ["ts"] } },
        }, null, 2));
        saveConfig(dir, { discovery: { extensions: [] } });
        const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect("extensions" in (written["debug-gui"].discovery ?? {})).toBe(false);
    });

    it("loadConfig returns extensions as undefined when not set", () => {
        const dir = mkdtempSync(join(tmpdir(), "dbg-"));
        writeFileSync(join(dir, "package.json"), JSON.stringify({}, null, 2));
        expect(loadConfig(dir).discovery.extensions).toBeUndefined();
    });
});
