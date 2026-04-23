import { readFileSync } from "fs";
import { join } from "path";

export interface DebugGuiConfig {
    mocha: {
        file?: string[];
        require?: string | string[];
        exclude?: string[];
        spec?: string[];
    };
    cdp: { port: number };
    discovery: { globs: string[] };
    agent: { idleTimeoutMs: number };
    preRun?: string;
}

const DEFAULT_GLOBS = [
    "test/**/*.spec.{js,ts}",
    "spec/**/*.test.{js,ts}",
];

export function loadConfig(cwd: string): DebugGuiConfig {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const dg = pkg["debug-gui"] ?? {};
    return {
        mocha: pkg.mocha ?? {},
        cdp: { port: dg.cdp?.port ?? 9222 },
        discovery: { globs: dg.discovery?.globs ?? DEFAULT_GLOBS },
        agent: { idleTimeoutMs: dg.agent?.idleTimeoutMs ?? 10 * 60 * 1000 },
        preRun: typeof dg.preRun === "string" && dg.preRun.length > 0 ? dg.preRun : undefined,
    };
}
