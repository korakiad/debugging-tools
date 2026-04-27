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
    discovery: { globs: string[]; exclude: string[]; extensions?: string[] };
    agent: { idleTimeoutMs: number };
    preRun?: string;
}

const DEFAULT_GLOBS = [
    "test/**/*.spec.{js,ts}",
    "spec/**/*.test.{js,ts}",
];

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export function loadConfig(cwd: string): DebugGuiConfig {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const dg = pkg["debug-gui"] ?? {};
    // One-time migration: if the user hasn't set discovery.exclude yet but
    // has a legacy mocha.exclude, treat the mocha value as the source.
    // Persisted on the next GUI save — we never silently rewrite on load.
    const exclude: string[] = Array.isArray(dg.discovery?.exclude)
        ? dg.discovery.exclude
        : (Array.isArray(pkg.mocha?.exclude) ? pkg.mocha.exclude : []);
    const extensions: string[] | undefined =
        Array.isArray(dg.discovery?.extensions) && dg.discovery.extensions.length > 0
            ? dg.discovery.extensions
            : undefined;
    return {
        mocha: pkg.mocha ?? {},
        cdp: { port: dg.cdp?.port ?? 9222 },
        discovery: {
            globs: Array.isArray(dg.discovery?.globs) ? dg.discovery.globs : DEFAULT_GLOBS,
            exclude,
            extensions,
        },
        agent: { idleTimeoutMs: dg.agent?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS },
        preRun: typeof dg.preRun === "string" && dg.preRun.length > 0 ? dg.preRun : undefined,
    };
}

export interface ConfigPatch {
    preRun?: string;
    idleTimeoutMs?: number;
    discovery?: {
        globs?: string[];
        exclude?: string[];
        // Empty array removes the key ("no override, use inference again").
        extensions?: string[];
    };
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

    if (patch.idleTimeoutMs !== undefined) {
        block.agent = { ...(block.agent ?? {}), idleTimeoutMs: patch.idleTimeoutMs };
    }

    if (patch.discovery) {
        const nextDiscovery = { ...(block.discovery ?? {}) };
        if (patch.discovery.globs !== undefined) nextDiscovery.globs = patch.discovery.globs;
        if (patch.discovery.exclude !== undefined) nextDiscovery.exclude = patch.discovery.exclude;
        if (patch.discovery.extensions !== undefined) {
            if (patch.discovery.extensions.length === 0) delete nextDiscovery.extensions;
            else nextDiscovery.extensions = patch.discovery.extensions;
        }
        block.discovery = nextDiscovery;
    }

    pkg["debug-gui"] = block;
    // Preserve indent by sniffing the existing file; fall back to 2.
    const indentMatch = raw.match(/^\{\n(\s+)"/);
    const indent = indentMatch ? indentMatch[1].length : 2;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + "\n");
    return loadConfig(cwd);
}
