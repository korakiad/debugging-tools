import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { readFile, writeFile } from "fs/promises";

export interface EditFileDeps {
    // Receives the FULL before/after file contents so the UI's diff
    // renderer can show a minimal, context-rich diff with all unchanged
    // lines preserved — not the agent's raw snippet inputs.
    onPropose: (
        file: string,
        oldCode: string,
        newCode: string
    ) => Promise<{ approved: boolean; reason?: string }>;
}

const editFileSchema = z.object({
    path: z.string(),
    oldContent: z.string(),
    newContent: z.string(),
});

export function makeEditFileTool(deps: EditFileDeps) {
    return defineTool<z.infer<typeof editFileSchema>>("edit_file", {
        description:
            "Edit a file by replacing `oldContent` with `newContent`. " +
            "`oldContent` must be either an exact unique substring of the " +
            "current file (the lines you want to change, with enough " +
            "surrounding context to be unique) OR the entire current file. " +
            "`newContent` is the replacement for that substring (or the full " +
            "rewritten file). All other lines are preserved verbatim. The QA " +
            "operator reviews the resulting diff and approves before any " +
            "change is written to disk.",
        overridesBuiltInTool: true,
        parameters: editFileSchema,
        handler: async ({ path, oldContent, newContent }) => {
            const currentContent = await readFile(path, "utf8");

            let nextContent: string;
            if (oldContent === currentContent) {
                // Whole-file rewrite. Sanity-check against the destructive
                // pattern where the agent passes the full file as oldContent
                // but only a fragment as newContent — that would silently
                // truncate the file on disk. Require the agent to use
                // substring-style instead in that case.
                const oldLines = currentContent.split(/\r?\n/).length;
                const newLines = newContent.split(/\r?\n/).length;
                if (oldLines >= 4 && newLines * 2 < oldLines) {
                    return {
                        applied: false,
                        rejection:
                            `Refusing to truncate ${path} from ${oldLines} to ${newLines} lines. ` +
                            "If you only want to change part of the file, pass that part as " +
                            "oldContent (with enough surrounding context to be unique) and the " +
                            "replacement as newContent — every other line is preserved automatically.",
                    };
                }
                nextContent = newContent;
            } else {
                const occurrences = countOccurrences(currentContent, oldContent);
                if (occurrences === 0) {
                    return {
                        applied: false,
                        rejection:
                            `oldContent not found in ${path}. Pass either the exact substring you want ` +
                            "to replace (with enough surrounding context to be unique) or the entire " +
                            "current file content.",
                    };
                }
                if (occurrences > 1) {
                    return {
                        applied: false,
                        rejection:
                            `oldContent matches ${occurrences} different places in ${path}. Provide more ` +
                            "surrounding context so that oldContent uniquely identifies one location.",
                    };
                }
                nextContent = replaceOnce(currentContent, oldContent, newContent);
            }

            const decision = await deps.onPropose(path, currentContent, nextContent);
            if (decision.approved) {
                await writeFile(path, nextContent);
                return { applied: true };
            }
            return { applied: false, rejection: decision.reason ?? "rejected" };
        },
    });
}

function countOccurrences(haystack: string, needle: string): number {
    if (needle.length === 0) return 0;
    let count = 0;
    let pos = 0;
    while ((pos = haystack.indexOf(needle, pos)) !== -1) {
        count += 1;
        pos += needle.length;
    }
    return count;
}

// String.prototype.replace treats `$&`, `$1`, etc. in the replacement as
// backreferences — agent-supplied newContent might legitimately contain
// dollar signs in regex literals or string templates, so replace with a
// splice that preserves them verbatim.
function replaceOnce(haystack: string, needle: string, replacement: string): string {
    const idx = haystack.indexOf(needle);
    if (idx === -1) return haystack;
    return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}
