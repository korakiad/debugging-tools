import { readFileSync, writeFileSync } from "fs";
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

export interface ConfigPatch {
    preRun?: string;
}

// Mutates consumer's package.json["debug-gui"] by applying `patch`.
// Empty-string values are treated as "remove this key" (keeps the on-disk
// block minimal and is how the UI signals "turn the feature off").
export function saveConfig(cwd: string, patch: ConfigPatch): DebugGuiConfig {
    const pkgPath = join(cwd, "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    const block = { ...(pkg["debug-gui"] ?? {}) };

    if (patch.preRun !== undefined) {
        if (patch.preRun === "") delete block.preRun;
        else block.preRun = patch.preRun;
    }

    pkg["debug-gui"] = block;
    // Preserve indent by sniffing the existing file; fall back to 2.
    const indentMatch = raw.match(/^\{\n(\s+)"/);
    const indent = indentMatch ? indentMatch[1].length : 2;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + "\n");
    return loadConfig(cwd);
}
