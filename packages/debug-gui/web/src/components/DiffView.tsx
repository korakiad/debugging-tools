import { useMemo } from "react";
import { FileDiff, useWorkerPool } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import type { SupportedLanguages } from "@pierre/diffs";
import { EfButton, EfPanel } from "../ui";

// Map a file path to one of @pierre/diffs' SupportedLanguages. Unknown
// extensions render as "text" — Pierre still draws the diff, just without
// syntax colours.
function pierreLanguageFor(path: string): SupportedLanguages {
    const lower = path.toLowerCase();
    if (lower.endsWith(".tsx")) return "tsx";
    if (lower.endsWith(".jsx")) return "jsx";
    if (lower.endsWith(".ts")) return "typescript";
    if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
        return "javascript";
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".md")) return "markdown";
    return "text";
}

export function DiffView({
    file,
    oldCode,
    newCode,
    onApprove,
    onReject,
}: {
    file: string;
    oldCode: string;
    newCode: string;
    onApprove: () => void;
    onReject: () => void;
}) {
    const language = pierreLanguageFor(file);
    const fileDiff = useMemo(
        () =>
            parseDiffFromFile(
                { name: file, contents: oldCode, lang: language },
                { name: file, contents: newCode, lang: language },
            ),
        [file, oldCode, newCode, language],
    );

    // When rendered without a WorkerPoolContextProvider in the tree (e.g. unit
    // tests, or Storybook), useWorkerPool() returns undefined and FileDiff
    // would otherwise stall on async worker init. Falling back to inline
    // tokenization keeps render synchronous in that case. In the real app the
    // provider is mounted at main.tsx so this resolves to false.
    const pool = useWorkerPool();
    const disableWorkerPool = !pool;

    return (
        <EfPanel style={{ display: "block" }}>
            <div
                className="text-xs p-2 opacity-70"
                style={{ borderBottom: "1px solid var(--ef-border-color)" }}
            >
                {file}
            </div>
            <FileDiff
                fileDiff={fileDiff}
                disableWorkerPool={disableWorkerPool}
                options={{ theme: "pierre-dark", diffStyle: "split" }}
            />
            <div
                className="p-2 flex gap-2 justify-end"
                style={{ borderTop: "1px solid var(--ef-border-color)" }}
            >
                <EfButton onClick={onReject} style={{ color: "var(--ef-error)" }}>
                    Reject
                </EfButton>
                <EfButton cta onClick={onApprove}>
                    Approve
                </EfButton>
            </div>
        </EfPanel>
    );
}
