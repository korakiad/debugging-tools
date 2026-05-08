import { describe, it, expect } from "vitest";
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    buildMochaFork,
    BUNDLED_LAUNCHER_PATH,
    killTree,
    spawnShellCommand,
} from "../src/runner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "fixtures/ipc-fail.spec.cjs");

describe("buildMochaFork", () => {
    it("emits --spec <spec> targeting BUNDLED_LAUNCHER_PATH", () => {
        const spec = buildMochaFork({ spec: "test/login.spec.js" });
        expect(spec.module).toBe(BUNDLED_LAUNCHER_PATH);
        expect(spec.args).toEqual(["--spec", "test/login.spec.js"]);
    });

    it("appends --grep when provided", () => {
        const spec = buildMochaFork({
            spec: "t.spec.js",
            grep: "^Login should enter username$",
        });
        expect(spec.args).toEqual([
            "--spec", "t.spec.js",
            "--grep", "^Login should enter username$",
        ]);
    });

    it("omits --grep when not provided", () => {
        const spec = buildMochaFork({ spec: "t.spec.js" });
        expect(spec.args.includes("--grep")).toBe(false);
    });

    it("threads bailOnFailure through DEBUG_GUI_BAIL_ON_FAILURE=1", () => {
        const spec = buildMochaFork({ spec: "t.spec.js", bailOnFailure: true });
        expect(spec.env.DEBUG_GUI_BAIL_ON_FAILURE).toBe("1");
    });

    it("does NOT set DEBUG_GUI_BAIL_ON_FAILURE when bailOnFailure is false/absent", () => {
        const spec = buildMochaFork({ spec: "t.spec.js" });
        expect(spec.env.DEBUG_GUI_BAIL_ON_FAILURE).toBeUndefined();
    });
});

describe("mocha-ipc-launcher (forked)", () => {
    it("pauses on failure, resumes on {type:'resume'}, exits with failures=1", async () => {
        // BAIL_ON_FAILURE=1 → retries(0) → exactly one pause → exit on resume.
        const child = fork(BUNDLED_LAUNCHER_PATH, ["--spec", FIXTURE], {
            env: { ...process.env, DEBUG_GUI_BAIL_ON_FAILURE: "1" },
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            silent: true,
        });

        const messages: any[] = [];
        let pausedReceived = false;
        let exitCode: number | null = null;

        const exitPromise = new Promise<void>((resolve) => {
            child.on("exit", (code) => {
                exitCode = code;
                resolve();
            });
        });

        child.on("message", (m: any) => {
            messages.push(m);
            if (m && m.type === "paused" && !pausedReceived) {
                pausedReceived = true;
                child.send({ type: "resume" });
            }
        });

        // 30 s ceiling — fixture should finish within ~1 s. Failsafe in case
        // the IPC handshake never completes; the test fails fast on the
        // assertions below rather than wedging the suite.
        const timeout = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("IPC fixture did not exit within 30s")), 30_000),
        );
        await Promise.race([exitPromise, timeout]);

        expect(pausedReceived).toBe(true);

        const paused = messages.find((m) => m && m.type === "paused");
        expect(paused).toBeDefined();
        expect(paused.failure).toBeDefined();
        expect(paused.failure.test).toBe("always fails");
        expect(paused.failure.error).toMatch(/intentional fail for IPC test/);
        expect(paused.failure.suite).toBe("ipc-fixture");
        // Hook attempt count is 1-indexed (currentRetry()+1). Exact
        // maxAttempts depends on Mocha's retries-inheritance internals, so
        // we only assert the protocol-level invariants the GUI cares about.
        expect(paused.failure.attempt).toBe(1);
        expect(typeof paused.failure.pausedAt).toBe("number");

        const done = messages.find((m) => m && m.type === "done");
        expect(done).toBeDefined();
        expect(done.failures).toBe(1);

        expect(exitCode).toBe(1);
    }, 35_000);
});

describe("killTree", () => {
    it("resolves for undefined pid without invoking tree-kill", async () => {
        await expect(killTree(undefined)).resolves.toBeUndefined();
    });

    it("resolves (never rejects) for a nonexistent pid — idempotent double-kill", async () => {
        // 2^31 - 1 is guaranteed not to be a live pid on any OS we target.
        // tree-kill surfaces an error to its callback, but we swallow it so
        // Stop + next-run-start can both call killTree safely.
        await expect(killTree(2 ** 31 - 1)).resolves.toBeUndefined();
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
        // Use `node -e` so we get identical behavior on Windows + POSIX.
        const code = await spawnShellCommand(
            `node -e "process.stdin.on('data',()=>{});process.stdin.on('end',()=>process.exit(0));process.stdin.resume()"`,
            { env: process.env, onStdout: () => {}, onStderr: () => {} }
        );
        expect(code).toBe(0);
    }, 5000);
});
