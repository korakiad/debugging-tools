import { globSync } from "glob";
import path from "path";

export interface Suite {
    relPath: string;
    absPath: string;
}

export function discoverSuites(
    cwd: string,
    opts: { globs: string[]; exclude?: string[] }
): Suite[] {
    const matches = globSync(opts.globs, {
        cwd,
        ignore: opts.exclude ?? [],
        absolute: false,
        posix: true,
    });
    return matches
        .map((relPath) => ({ relPath, absPath: path.resolve(cwd, relPath) }))
        .sort((a, b) => a.relPath.localeCompare(b.relPath));
}
