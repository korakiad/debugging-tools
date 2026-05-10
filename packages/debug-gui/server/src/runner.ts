import { spawn, fork, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { fileURLToPath } from "node:url";
import treeKill from "tree-kill";

// Bundled mocha-ipc-launcher entry point. Resolves correctly under both
// dev (tsx: src/runner.ts) and prod (dist/runner.js) layouts since both
// sit one level under the package root with `runtime/` as a sibling.
export const BUNDLED_LAUNCHER_PATH = fileURLToPath(
    new URL("../runtime/mocha-ipc-launcher.cjs", import.meta.url)
);

export interface ShellSpawnOptions {
    env: NodeJS.ProcessEnv;
    onStdout: (text: string) => void;
    onStderr: (text: string) => void;
    onSpawn?: (pid: number) => void;
}

// Runs an arbitrary shell command string (e.g. "npm run build"). Single-shot
// — resolves with the exit code. shell:true so the command string is parsed
// by cmd.exe / sh, which is what users mean when they type
// "npm run build && something".
export function spawnShellCommand(cmd: string, opts: ShellSpawnOptions): Promise<number> {
    return new Promise((resolve) => {
        const proc = spawn(cmd, { env: opts.env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
        if (proc.pid && opts.onSpawn) opts.onSpawn(proc.pid);
        proc.stdout?.on("data", (d) => opts.onStdout(d.toString()));
        proc.stderr?.on("data", (d) => opts.onStderr(d.toString()));
        proc.on("exit", (code) => resolve(code ?? 1));
        proc.on("error", () => resolve(1));
    });
}

export interface BuildOptions {
    spec: string;
    // Mocha --grep value (regex source). When set, only tests whose full
    // title matches the regex run. Built from the user's tree selection;
    // see parseSuite.mochaGrepFor.
    grep?: string;
    // When true the bundled launcher's hooks switch to step-style behaviour:
    // retries off + bail subsequent it/describe siblings as soon as one
    // test fails. Surfaced via DEBUG_GUI_BAIL_ON_FAILURE=1 in the worker env.
    bailOnFailure?: boolean;
}

export interface ForkSpec {
    module: string;
    args: string[];
    env: NodeJS.ProcessEnv;
}

// Build the argv + env for fork()'ing mocha-ipc-launcher.cjs. The launcher
// boots Mocha programmatically and pushes status/paused frames over the
// Node IPC channel — there is no localhost HTTP and no PID watchdog, so
// no port/pid plumbing is required.
export function buildMochaFork(opts: BuildOptions): ForkSpec {
    const args: string[] = ["--spec", opts.spec];
    if (opts.grep) args.push("--grep", opts.grep);

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (opts.bailOnFailure) env.DEBUG_GUI_BAIL_ON_FAILURE = "1";

    return { module: BUNDLED_LAUNCHER_PATH, args, env };
}

// Cross-platform "kill this process AND every descendant it spawned."
//
// Required for the hard-kill fallback in sendStopAndKill — Mocha does not
// run afterAll() on abrupt exit, so WDIO's deleteSession() never fires
// without the tree-walk. Chrome stays alive with a locked profile dir and
// the next `remote()` call hits "unexpected alert open" or "unable to
// connect to renderer".
//
// tree-kill uses `taskkill /T /F` on Windows and a `ps`-based descendant
// walk on POSIX, so it handles the orphan problem on every OS our QA
// machines run on.
//
// Must be idempotent (called on Stop AND again at next run's start); the
// promise always resolves, even on error, so double-calls never throw.
export function killTree(pid: number | undefined): Promise<void> {
    return new Promise((resolve) => {
        if (!pid) return resolve();
        treeKill(pid, "SIGKILL", () => resolve());
    });
}

export class MochaRunner extends EventEmitter {
    private proc?: ChildProcess;

    async start(spec: ForkSpec): Promise<ChildProcess> {
        // Defense-in-depth: if a previous run's worker is still alive
        // (Stop wasn't clicked, tab closed, previous kill missed something),
        // reap before spawning so its ChromeDriver doesn't compete for the
        // user-data-dir lock.
        await killTree(this.proc?.pid);

        // stdio: ['ignore','pipe','pipe','ipc'] preserves the LogPanel feed
        // (proc.stdout?.on('data', …) → WS broadcast). Using 'inherit' would
        // route mocha output to the GUI server's terminal instead.
        this.proc = fork(spec.module, spec.args, {
            env: spec.env,
            stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        this.proc.stdout?.on("data", (d: Buffer) => this.emit("stdout", d.toString()));
        this.proc.stderr?.on("data", (d: Buffer) => this.emit("stderr", d.toString()));
        this.proc.on("exit", (code) => this.emit("exit", code));
        return this.proc;
    }

    get child(): ChildProcess | undefined {
        return this.proc;
    }

    // Graceful stop with hard-kill fallback. Sends {type:'stop'} so the
    // launcher's afterEach throws and Mocha tears the suite down via
    // afterAll (WDIO deleteSession). If the worker doesn't exit within
    // timeoutMs (wedged WDIO session, etc.), fall back to killTree().
    async sendStopAndKill(timeoutMs = 5000): Promise<void> {
        const proc = this.proc;
        if (!proc) return;
        if (proc.connected) {
            try {
                proc.send({ type: "stop" });
            } catch {
                /* parent IPC pipe already gone */
            }
        }
        await new Promise<void>((resolve) => {
            const timer = setTimeout(async () => {
                await killTree(proc.pid);
                resolve();
            }, timeoutMs);
            proc.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    async kill(): Promise<void> {
        await killTree(this.proc?.pid);
    }
}
