// Frontend mirror of server/src/parseSuite.ts:mochaGrepFor.
// Kept duplicated (5 lines, no shared package) so the web bundle has no
// hard dep on @debug-gui/server's TypeScript output.

export type SelectedKind = "describe" | "it";

export interface SelectedNode {
    kind: SelectedKind;
    fullTitle: string;
}

// Build a Mocha --grep regex source from a selected describe/it node.
// Returns null when the title is dynamic — the caller should fall back to
// running the whole spec file (no --grep).
export function mochaGrepFor(node: SelectedNode | null): string | null {
    if (!node) return null;
    if (!node.fullTitle) return null;
    if (node.fullTitle.includes("<dynamic>") || node.fullTitle.includes("<missing>")) return null;
    const escaped = escapeRegex(node.fullTitle);
    return node.kind === "it" ? `^${escaped}$` : `^${escaped} `;
}

export function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
