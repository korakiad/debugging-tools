// Convert a user's tree-picker selection into a list of glob patterns
// suitable for `debug-gui.discovery.globs`.
//
// Inputs:
//   selection.dirs  — relative paths of directories the user ticked
//   selection.files — relative paths of individual files the user ticked
//   currentGlobs    — the list already saved in config (for reference only:
//                     you may want to extract the trailing extension pattern
//                     from this, e.g. "**/*.spec.{js,ts}" from "test/**/*.spec.{js,ts}")
//
// Output: string[] of globs. Order doesn't matter for correctness, but try
// to keep it stable for a clean `package.json` diff.
//
// Contract (enforced by tests below):
//   1. Empty selection → [] (nothing discovered)
//   2. A file is emitted as its literal path
//   3. A directory is emitted as a glob matching the directory's descendants
//   4. Redundant items are de-duplicated — if a directory covers a selected
//      file, the file should not also appear. (Your choice: document it.)

export interface TreeSelection {
    dirs: string[];
    files: string[];
}

export interface ProjectionContext {
    currentGlobs: string[];
    // Optional override. When present and non-empty, replaces the extension
    // portion of the derived pattern. Teams using `.js` vs `.ts` vs mixed
    // sets should set this explicitly to avoid surprise inference.
    extensions?: string[];
}

// Default extension pattern used when no hint can be derived from currentGlobs.
export const DEFAULT_EXT_PATTERN = "**/*.spec.{js,ts}";

export function selectionToGlobs(
    selection: TreeSelection,
    ctx: ProjectionContext = { currentGlobs: [] },
): string[] {
    // ┌─── PRODUCT DECISION POINT ────────────────────────────────────────┐
    // │ The rules below are a reasonable default. If you want different   │
    // │ semantics (e.g. keep redundant files, or emit "dir/**/*" instead  │
    // │ of matching the test extension pattern), edit this function.     │
    // │ Tests in projection.test.ts pin the expected behavior.            │
    // └───────────────────────────────────────────────────────────────────┘
    let extPattern = deriveExtPattern(ctx.currentGlobs) ?? DEFAULT_EXT_PATTERN;
    if (ctx.extensions && ctx.extensions.length > 0) {
        extPattern = withExtensions(extPattern, ctx.extensions);
    }

    const dirGlobs = selection.dirs.map((d) => `${d}/${extPattern}`);
    const keptFiles = selection.files.filter(
        (f) => !selection.dirs.some((d) => isDescendant(f, d)),
    );

    return Array.from(new Set([...dirGlobs, ...keptFiles])).sort();
}

function deriveExtPattern(currentGlobs: string[]): string | null {
    // Match the trailing "**/..." of the first glob that looks like a test
    // discovery pattern. Example: "test/**/*.spec.{js,ts}" → "**/*.spec.{js,ts}".
    for (const g of currentGlobs) {
        const m = g.match(/\/(\*\*\/.+)$/);
        if (m) return m[1];
    }
    return null;
}

// Replace the trailing extension part of a pattern with the supplied list.
// "**/*.spec.{js,ts}" + ["ts"] → "**/*.spec.ts"
// "**/*.test.ts"      + ["ts","tsx"] → "**/*.test.{ts,tsx}"
export function withExtensions(pattern: string, exts: string[]): string {
    const clean = exts.map((e) => e.replace(/^\./, "")).filter((e) => e.length > 0);
    if (clean.length === 0) return pattern;
    const replacement = clean.length === 1 ? clean[0] : `{${clean.join(",")}}`;
    return pattern.replace(/\.([a-zA-Z0-9]+|\{[^}]+\})$/, `.${replacement}`);
}

// Helper you may find useful when writing (c).
export function isDescendant(filePath: string, dirPath: string): boolean {
    if (dirPath === "") return true;
    const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
    return filePath.startsWith(prefix);
}
