import { describe, it, expect } from "vitest";
import {
    buildMochaCommand,
    BUNDLED_HOOK_PATH,
    killTree,
    shellQuote,
    spawnShellCommand,
} from "../src/runner.js";

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
            "--timeout", "0",
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
            "--timeout", "0",
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

    it("appends --grep <pattern> when grep is set, after --require", () => {
        const cmd = buildMochaCommand({
            spec: "test/login.spec.js",
            guiPort: 5555,
            guiPid: 1,
            grep: "^SauceDemo Login should enter username$",
        });
        expect(cmd.args).toEqual([
            "mocha", "test/login.spec.js",
            "--require", BUNDLED_HOOK_PATH,
            "--grep", "^SauceDemo Login should enter username$",
            "--timeout", "0",
        ]);
    });

    it("omits --grep entirely when grep is not provided", () => {
        const cmd = buildMochaCommand({
            spec: "t.spec.js",
            guiPort: 5555,
            guiPid: 1,
        });
        expect(cmd.args.includes("--grep")).toBe(false);
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
        expect(cmd.args).toContain(BUNDLED_HOOK_PATH);
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

describe("shellQuote", () => {
    it("leaves safe args (alnum/path chars) unquoted on every platform", () => {
        for (const p of ["win32", "darwin", "linux"] as const) {
            expect(shellQuote("mocha", p)).toBe("mocha");
            expect(shellQuote("test/login.spec.js", p)).toBe("test/login.spec.js");
            expect(shellQuote("--grep", p)).toBe("--grep");
            expect(shellQuote("C:\\path\\to\\hook.cjs", p)).toBe("C:\\path\\to\\hook.cjs");
            expect(shellQuote("/Users/foo/proj/hook.cjs", p)).toBe("/Users/foo/proj/hook.cjs");
        }
    });

    describe("Windows (cmd.exe rules)", () => {
        it("wraps args containing spaces in double quotes", () => {
            expect(shellQuote("^Login Form ", "win32")).toBe(`"^Login Form "`);
        });

        it("doubles internal double-quotes (cmd.exe convention)", () => {
            expect(shellQuote(`a"b`, "win32")).toBe(`"a""b"`);
        });

        it("quotes args with shell metacharacters even without spaces", () => {
            // `^` outside quotes is cmd.exe's escape character — without
            // quoting, `^Login` becomes `Login`.
            expect(shellQuote("^Login", "win32")).toBe(`"^Login"`);
        });
    });

    describe("POSIX (sh rules — covers macOS/linux)", () => {
        it("wraps args containing spaces in single quotes on darwin", () => {
            expect(shellQuote("^Login Form ", "darwin")).toBe("'^Login Form '");
        });

        it("wraps args containing spaces in single quotes on linux", () => {
            expect(shellQuote("^Login Form ", "linux")).toBe("'^Login Form '");
        });

        it("preserves regex anchors ^ and $ literally inside single quotes", () => {
            // Inside single quotes sh does NOT expand or interpret anything,
            // so `$` stays a `$` and Mocha receives the regex untouched.
            expect(shellQuote("^Login Form should click$", "darwin")).toBe(
                "'^Login Form should click$'"
            );
        });

        it("escapes internal single quotes via the standard '\\'' recipe", () => {
            expect(shellQuote("a'b", "darwin")).toBe("'a'\\''b'");
        });
    });
});

describe("spawnShellCommand", () => {
    it("runs a simple echo and resolves with exit code 0", async () => {
        const chunks: string[] = [];
        const code = await spawnShellCommand("echo hello-prerun", {
            env: process.env,
            onStdout: (t) => chunks.push(t),
            onStderr: () => {},
        });
        expect(code).toBe(0);
        expect(chunks.join("")).toMatch(/hello-prerun/);
    });

    it("resolves with the non-zero exit code of a failing command", async () => {
        // `exit 2` works under cmd.exe and sh alike (shell: true handles both).
        const code = await spawnShellCommand("exit 2", {
            env: process.env,
            onStdout: () => {},
            onStderr: () => {},
        });
        expect(code).toBe(2);
    });

    it("closes stdin so commands that read stdin exit immediately", async () => {
        // A command that reads from stdin and echoes it back. With stdin
        // closed, the read returns EOF and the process exits. Without
        // closing stdin, this would hang forever waiting for input.
        // Use `node -e` so we get identical behavior on Windows + POSIX.
        const code = await spawnShellCommand(
            `node -e "process.stdin.on('data',()=>{});process.stdin.on('end',()=>process.exit(0));process.stdin.resume()"`,
            { env: process.env, onStdout: () => {}, onStderr: () => {} }
        );
        expect(code).toBe(0);
    }, 5000);
});
