import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { fileURLToPath } from "node:url";

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
    walkthroughPort: number;
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
        env: { ...process.env, WALKTHROUGH_PORT: String(opts.walkthroughPort) },
    };
}

export class MochaRunner extends EventEmitter {
    private proc?: ChildProcess;

    start(cmd: MochaCommand): ChildProcess {
        this.proc = spawn(cmd.command, cmd.args, { env: cmd.env, shell: true });
        this.proc.stdout?.on("data", (d) => this.emit("stdout", d.toString()));
        this.proc.stderr?.on("data", (d) => this.emit("stderr", d.toString()));
        this.proc.on("exit", (code) => this.emit("exit", code));
        return this.proc;
    }

    kill(): void {
        this.proc?.kill();
    }
}
