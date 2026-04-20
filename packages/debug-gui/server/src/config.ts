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
    walkthroughPort: number;
    discovery: { globs: string[] };
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
        walkthroughPort: dg.walkthroughPort ?? 3456,
        discovery: { globs: dg.discovery?.globs ?? DEFAULT_GLOBS },
    };
}
