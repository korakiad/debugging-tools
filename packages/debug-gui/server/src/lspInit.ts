export const DEFAULT_TS_BLOCK = {
    lspServers: {
        typescript: {
            command: "typescript-language-server",
            args: ["--stdio"],
            fileExtensions: {
                ".ts": "typescript",
                ".tsx": "typescriptreact",
                ".js": "javascript",
                ".jsx": "javascriptreact",
                ".mjs": "javascript",
                ".cjs": "javascript",
                ".mts": "typescript",
                ".cts": "typescript",
            },
        },
    },
} as const;

export interface MergeResult {
    next: unknown;
    changed: boolean;
}

export function mergeLspConfig(existing: unknown): MergeResult {
    if (existing === null || typeof existing !== "object") {
        return { next: structuredClone(DEFAULT_TS_BLOCK), changed: true };
    }
    const obj = existing as Record<string, unknown>;
    const servers = (obj.lspServers ?? {}) as Record<string, unknown>;
    if (servers.typescript) {
        return { next: existing, changed: false };
    }
    return {
        next: {
            ...obj,
            lspServers: {
                ...servers,
                typescript: structuredClone(DEFAULT_TS_BLOCK.lspServers.typescript),
            },
        },
        changed: true,
    };
}
