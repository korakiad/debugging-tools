import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { fileURLToPath } from "node:url";
import treeKill from "tree-kill";

// Resolve the bundled walkthrough hook path. Works in both layouts:
//   dev (tsx): src/runner.ts  → ../runtime/walkthrough-hooks.cjs
//   prod:     dist/runner.js  → ../runtime/walkthrough-hooks.cjs
export const BUNDLED_HOOK_PATH = fileURLToPath(
    new URL("../runtime/walkthrough-hooks.cjs", import.meta.url)
);

export interface CustomCommand {
    cmd: string;
    args: string[];
}

export interface BuildOptions {
    spec: string;
    // Gui server port — hook POSTs state here via HTTP.
    guiPort: number;
    // Gui server pid — hook polls process.kill(pid, 0) for parent-death detection.
    guiPid: number;
    customCommand?: CustomCommand;
}

export interface MochaCommand {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
}

export function buildMochaCommand(opts: BuildOptions): MochaCommand {
    const command = opts.customCommand?.cmd ?? "npx";
    const args = opts.customCommand
        ? [...opts.customCommand.args, opts.spec]
        : ["mocha", opts.spec];

    // Mocha auto-reads package.json.mocha (require, file, timeout, reporter,
    // ...), so we do NOT forward those — doing so would load each --require
    // twice. We only piggy-back the pause-on-failure hook.
    args.push("--require", BUNDLED_HOOK_PATH);

    return {
        command,
        args,
        env: {
            ...process.env,
            DEBUG_GUI_PORT: String(opts.guiPort),
            DEBUG_GUI_PID: String(opts.guiPid),
        },
    };
}

// Cross-platform "kill this process AND every descendant it spawned."
//
// We need a tree kill — not a plain proc.kill() — because:
//   (1) spawn(..., { shell: true }) wraps the command in cmd.exe on Windows
//       (or /bin/sh on POSIX); the default signal only reaches the shell,
//       leaving node/chromedriver/chrome orphaned.
//   (2) Mocha does NOT run afterAll() on abrupt exit, so WDIO's
//       deleteSession() never fires. Chrome stays alive with a locked
//       profile dir and the next `remote()` call hits
//       "unexpected alert open" or "unable to connect to renderer".
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

    async start(cmd: MochaCommand): Promise<ChildProcess> {
        // Defense-in-depth: if a previous run's process is still alive
        // (Stop wasn't clicked, or tab was closed, or previous kill missed
        // something), reap its tree before spawning a new one. Otherwise
        // the new ChromeDriver may adopt the orphaned Chrome's profile.
        await killTree(this.proc?.pid);
        this.proc = spawn(cmd.command, cmd.args, { env: cmd.env, shell: true });
        this.proc.stdout?.on("data", (d) => this.emit("stdout", d.toString()));
        this.proc.stderr?.on("data", (d) => this.emit("stderr", d.toString()));
        this.proc.on("exit", (code) => this.emit("exit", code));
        return this.proc;
    }

    async kill(): Promise<void> {
        await killTree(this.proc?.pid);
    }
}
