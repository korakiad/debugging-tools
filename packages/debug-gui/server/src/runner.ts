import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface BuildOptions {
    spec: string;
    walkthroughPort: number;
    mocha: { require?: string | string[]; file?: string[] };
    customCommand?: string;
}

export interface MochaCommand {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
}

export function buildMochaCommand(opts: BuildOptions): MochaCommand {
    const command = opts.customCommand ?? "npx";
    const args = opts.customCommand ? [opts.spec] : ["mocha", opts.spec];

    const requires = toArray(opts.mocha.require);
    for (const r of requires) {
        args.push("--require", r);
    }
    for (const f of opts.mocha.file ?? []) {
        args.push("--file", f);
    }

    return {
        command,
        args,
        env: { ...process.env, WALKTHROUGH_PORT: String(opts.walkthroughPort) },
    };
}

function toArray(v: string | string[] | undefined): string[] {
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
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
