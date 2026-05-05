import { spawn } from "node:child_process";

export const DEFAULT_TS_BLOCK = {
    lspServers: {
        typescript: {
            command: "typescript-language-server",
            args: ["--stdio"],
            fileExtensions: {
                ".ts": "typescript",
                ".tsx": "typescriptreact",
                ".js": "javascript",
                ".jsx": "javascriptreact",
                ".mjs": "javascript",
                ".cjs": "javascript",
                ".mts": "typescript",
                ".cts": "typescript",
            },
        },
    },
} as const;

export interface MergeResult {
    next: unknown;
    changed: boolean;
}

export function mergeLspConfig(existing: unknown): MergeResult {
    if (existing === null || typeof existing !== "object") {
        return { next: structuredClone(DEFAULT_TS_BLOCK), changed: true };
    }
    const obj = existing as Record<string, unknown>;
    const servers = (obj.lspServers ?? {}) as Record<string, unknown>;
    if (servers.typescript) {
        return { next: existing, changed: false };
    }
    return {
        next: {
            ...obj,
            lspServers: {
                ...servers,
                typescript: structuredClone(DEFAULT_TS_BLOCK.lspServers.typescript),
            },
        },
        changed: true,
    };
}

export type ProbeResult =
    | { kind: "ok" }
    | { kind: "missing" }
    | { kind: "broken"; stderrTail: string };

const STDERR_TAIL_BYTES = 2048;

export async function probeBinary(cmd: string, args: string[], timeoutMs: number): Promise<ProbeResult> {
    const result = await trySpawn(cmd, args, timeoutMs);
    // npm-installed CLI tools on Windows ship as `<name>.cmd` shims that
    // spawn() won't resolve unless the extension is explicit. Retry once
    // when the bare name was missing.
    if (
        result.kind === "missing" &&
        process.platform === "win32" &&
        !/\.(cmd|bat|exe)$/i.test(cmd)
    ) {
        const retry = await trySpawn(cmd + ".cmd", args, timeoutMs);
        if (retry.kind !== "missing") return retry;
    }
    return result;
}

function trySpawn(cmd: string, args: string[], timeoutMs: number): Promise<ProbeResult> {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (r: ProbeResult) => {
            if (settled) return;
            settled = true;
            resolve(r);
        };

        let stderr = "";
        let child;
        try {
            child = spawn(cmd, args);
        } catch (err) {
            // Node 24+ on Windows throws EINVAL synchronously when asked to
            // spawn a non-existent .cmd path, instead of emitting ENOENT
            // through the error event. Treat both as "missing".
            const e = err as NodeJS.ErrnoException;
            if (e.code === "ENOENT" || e.code === "EINVAL") return settle({ kind: "missing" });
            return settle({ kind: "broken", stderrTail: e.message });
        }

        const timer = setTimeout(() => {
            child.kill();
            settle({ kind: "broken", stderrTail: "timeout after " + timeoutMs + "ms" });
        }, timeoutMs);

        child.on("error", (err: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            if (err.code === "ENOENT") return settle({ kind: "missing" });
            settle({ kind: "broken", stderrTail: err.message });
        });

        child.stderr?.on("data", (chunk: Buffer) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
        });

        child.on("exit", (code) => {
            clearTimeout(timer);
            if (code === 0) return settle({ kind: "ok" });
            settle({ kind: "broken", stderrTail: stderr || `exited with code ${code}` });
        });
    });
}
