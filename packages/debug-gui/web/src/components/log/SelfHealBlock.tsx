import { EfPanel } from "../../ui";
import type { HealMeta } from "./deriveLog";

interface SelfHealBlockProps extends HealMeta {
    timeMs?: number;
}

const PLACEHOLDER = "—";

export function SelfHealBlock({ strategy, confidence, durationMs, oldCode, newCode, filePath }: SelfHealBlockProps) {
    return (
        <EfPanel spacing className="log-heal-block">
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
                    <span className="log-heal-block-diff-line removed">- {oldCode}</span>
                    {"\n"}
                    <span className="log-heal-block-diff-line added">+ {newCode}</span>
                </code>
            </pre>
        </EfPanel>
    );
}
