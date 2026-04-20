import { globSync } from "glob";

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
        .map((m) => m.replace(/\\/g, "/"))
        .map((relPath) => ({ relPath, absPath: `${cwd}/${relPath}` }))
        .sort((a, b) => a.relPath.localeCompare(b.relPath));
}
