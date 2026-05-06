import { useState } from "react";
import { Highlight, themes } from "prism-react-renderer";

export interface CodePreviewProps {
    code: string;
    // 1-based file line number where `code` starts. We display this in the
    // gutter so the QA operator can map a row back to the on-disk file.
    startLine: number;
    // "javascript" | "typescript" | "tsx" | "jsx". prism-react-renderer's
    // bundled grammars cover all four.
    language?: "javascript" | "typescript" | "tsx" | "jsx";
    // Inferred from the spec extension when undefined; default falls back to
    // typescript which is a permissive superset for our purposes.
    title?: string;
    // Initial collapsed state. Defaults to expanded. The component manages
    // its own collapse state — caller doesn't need to thread it through.
    defaultCollapsed?: boolean;
}

// Minimum-viable code viewer: read-only, no caret, no scrolling jank, no
// editor chrome. Goal is "looks like syntax-highlighted source", not "looks
// like VS Code". The selected node's file extension drives grammar choice;
// users editing JS will see strings/keywords/comments coloured the same way
// they would in any modern dark theme.
export function CodePreview({ code, startLine, language = "tsx", title, defaultCollapsed = false }: CodePreviewProps) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    return (
        <div className="border border-gray-700 overflow-hidden bg-[#1e1e1e]">
            <div className="flex items-center text-xs px-3 py-1.5 border-b border-gray-700 bg-neutral-900/60 font-mono">
                <span className="opacity-80 truncate flex-1">{title ?? ""}</span>
                <button
                    type="button"
                    aria-label={collapsed ? "Expand code" : "Collapse code"}
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsed((v) => !v)}
                    className="ml-2 shrink-0 opacity-70 hover:opacity-100 px-2 py-0.5 rounded hover:bg-white/5 transition-opacity"
                    data-testid="code-preview-toggle"
                >
                    {collapsed ? "▸ Expand" : "▾ Collapse"}
                </button>
            </div>
            {!collapsed && (
                <Highlight code={code} language={language} theme={themes.vsDark}>
                    {({ className, style, tokens, getLineProps, getTokenProps }) => (
                        <pre
                            className={`${className} text-xs leading-relaxed m-0 p-3 overflow-auto max-h-[420px]`}
                            style={{ ...style, background: "transparent" }}
                            data-testid="code-preview"
                        >
                            {tokens.map((line, i) => {
                                const lineProps = getLineProps({ line });
                                return (
                                    <div {...lineProps} key={i} className="flex">
                                        <span
                                            aria-hidden="true"
                                            className="select-none opacity-40 pr-3 text-right tabular-nums w-10 shrink-0"
                                        >
                                            {startLine + i}
                                        </span>
                                        <span className="flex-1 whitespace-pre">
                                            {line.map((token, j) => (
                                                <span key={j} {...getTokenProps({ token })} />
                                            ))}
                                        </span>
                                    </div>
                                );
                            })}
                        </pre>
                    )}
                </Highlight>
            )}
        </div>
    );
}

// Picks a Prism grammar from the spec's file extension. Defaults to "tsx"
// because it's the most permissive of the four — it parses plain JS without
// surprises, but also handles JSX/TS so users with mixed test suites get the
// right colours.
export function languageFromPath(path: string): CodePreviewProps["language"] {
    const lower = path.toLowerCase();
    if (lower.endsWith(".tsx")) return "tsx";
    if (lower.endsWith(".jsx")) return "jsx";
    if (lower.endsWith(".ts")) return "typescript";
    if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
    return "tsx";
}

// Slice file source between 1-based [startLine, endLine] inclusive.
// Returns `null` when the range can't be honoured — caller renders nothing.
export function sliceSource(source: string | undefined, startLine: number, endLine: number): string | null {
    if (!source) return null;
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null;
    if (startLine < 1 || endLine < startLine) return null;
    const lines = source.split(/\r?\n/);
    const slice = lines.slice(startLine - 1, endLine);
    if (slice.length === 0) return null;
    return slice.join("\n");
}
