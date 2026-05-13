export interface SuiteNode {
    kind: "describe" | "it";
    title: string;
    fullTitle: string;
    line: number;
    endLine: number;
    children: SuiteNode[];
    pending?: boolean;
    only?: boolean;
}

export interface SuiteTree {
    file: string;
    relPath: string;
    children: SuiteNode[];
    source?: string;
    error?: string;
}
