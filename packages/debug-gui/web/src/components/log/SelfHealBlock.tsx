import type { HealMeta } from "./deriveLog";

const PLACEHOLDER = "—";

export function SelfHealBlock({ strategy, confidence, durationMs, oldCode, newCode, filePath }: HealMeta) {
    const hunk = focusedHunk(oldCode, newCode);
    return (
        <section className="log-heal-block">
            <header className="log-heal-block-header">
                <span className="log-heal-block-badge">SELF-HEAL</span>
                <span className="log-heal-block-strategy">
                    <span className="log-heal-block-strategy-label">STRATEGY</span>
                    <span className="log-heal-block-strategy-value">{strategy}</span>
                </span>
                <span className="log-heal-block-meta">
                    <span className="log-heal-block-meta-label">conf</span>
                    <span className="log-heal-block-meta-value">
                        {confidence != null ? confidence.toFixed(2) : PLACEHOLDER}
                    </span>
                </span>
                <span className="log-heal-block-meta">
                    <span className="log-heal-block-meta-value">
                        {durationMs != null ? `${durationMs}ms` : PLACEHOLDER}
                    </span>
                </span>
            </header>
            {filePath && (
                <div className="log-heal-block-file" aria-label="self-heal file">
                    {filePath}
                </div>
            )}
            <pre className="log-heal-block-diff" aria-label="self-heal diff">
                <code>
                    {hunk.removed.map((line, i) => (
                        <span key={`r${i}`} className="log-heal-block-diff-line removed">
                            {`- ${line}\n`}
                        </span>
                    ))}
                    {hunk.added.map((line, i) => (
                        <span key={`a${i}`} className="log-heal-block-diff-line added">
                            {`+ ${line}\n`}
                        </span>
                    ))}
                </code>
            </pre>
        </section>
    );
}

// Extract the contiguous run of changed lines between two file revisions
// by stripping the longest matching prefix/suffix. The log-side view only
// needs to show "what's different" — a full file diff lives in DiffView.
//
// For non-contiguous edits this still works: it returns the smallest
// window that contains every change, which renders as a single hunk
// rather than many tiny ones. That matches the spirit of an audit log
// row (compact summary, not a full review surface).
export function focusedHunk(
    oldCode: string,
    newCode: string,
): { removed: string[]; added: string[] } {
    const oldLines = oldCode.split(/\r?\n/);
    const newLines = newCode.split(/\r?\n/);

    let prefix = 0;
    const minLen = Math.min(oldLines.length, newLines.length);
    while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
        prefix += 1;
    }

    let suffix = 0;
    while (
        suffix < oldLines.length - prefix &&
        suffix < newLines.length - prefix &&
        oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) {
        suffix += 1;
    }

    return {
        removed: oldLines.slice(prefix, oldLines.length - suffix),
        added: newLines.slice(prefix, newLines.length - suffix),
    };
}
