import type { SuiteNode, SuiteTree, SelectedNode } from "../state/store";

// DFS the parsed tree for the SuiteNode that matches the user's selection.
// Returns null when the selection is no longer present (file was edited and
// the tree was re-parsed since selection was made).
export function findNode(tree: SuiteTree | undefined, sel: SelectedNode | null): SuiteNode | null {
    if (!tree || !sel) return null;
    const stack: SuiteNode[] = [...tree.children];
    while (stack.length > 0) {
        const n = stack.pop()!;
        if (n.kind === sel.kind && n.fullTitle === sel.fullTitle) return n;
        for (const c of n.children) stack.push(c);
    }
    return null;
}
