import { describe, it, expect } from "vitest";
import { buildMochaCommand, BUNDLED_HOOK_PATH, killTree } from "../src/runner.js";

describe("buildMochaCommand", () => {
    it("defaults to npx mocha and injects DEBUG_GUI_PORT + DEBUG_GUI_PID", () => {
        const cmd = buildMochaCommand({
            spec: "test/login.spec.js",
            guiPort: 5555,
            guiPid: 12345,
        });
        expect(cmd.command).toBe("npx");
        expect(cmd.env.DEBUG_GUI_PORT).toBe("5555");
        expect(cmd.env.DEBUG_GUI_PID).toBe("12345");
        expect(cmd.args).toEqual([
            "mocha", "test/login.spec.js",
            "--require", BUNDLED_HOOK_PATH,
        ]);
    });

    it("uses custom mocha command when provided", () => {
        const cmd = buildMochaCommand({
            spec: "test/login.spec.js",
            guiPort: 5555,
            guiPid: 1,
            customCommand: { cmd: "node", args: ["./bin/mocha"] },
        });
        expect(cmd.command).toBe("node");
        expect(cmd.args).toEqual([
            "./bin/mocha", "test/login.spec.js",
            "--require", BUNDLED_HOOK_PATH,
        ]);
    });

    it("threads extra flags from customCommand through to mocha", () => {
        const cmd = buildMochaCommand({
            spec: "t.spec.js",
            guiPort: 5555,
            guiPid: 1,
            customCommand: { cmd: "mocha", args: ["--timeout", "60000"] },
        });
        expect(cmd.args).toEqual([
            "--timeout", "60000",
            "t.spec.js",
            "--require", BUNDLED_HOOK_PATH,
        ]);
    });

    it("does NOT forward package.json mocha.require — Mocha auto-reads it", () => {
        // Regression: forwarding used to double-load each require.
        const cmd = buildMochaCommand({
            spec: "t.spec.js",
            guiPort: 5555,
            guiPid: 1,
        });
        const requires = cmd.args.filter((a) => a === "--require");
        expect(requires.length).toBe(1);
        expect(cmd.args[cmd.args.length - 1]).toBe(BUNDLED_HOOK_PATH);
    });
});

describe("killTree", () => {
    it("resolves for undefined pid without invoking tree-kill", async () => {
        await expect(killTree(undefined)).resolves.toBeUndefined();
    });

    it("resolves (never rejects) for a nonexistent pid — idempotent double-kill", async () => {
        // 2^31 - 1 is guaranteed not to be a live pid on any OS we target.
        // tree-kill will surface an error to its callback, but we swallow
        // it so Stop + next-run-start can both call killTree safely.
        await expect(killTree(2 ** 31 - 1)).resolves.toBeUndefined();
    });
});
