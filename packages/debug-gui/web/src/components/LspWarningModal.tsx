import { EfButton, EfDialog } from "../ui";
import type { LspWarning } from "../state/store";

const TITLES: Record<LspWarning["kind"], string> = {
    missing: "LSP server not installed",
    broken: "LSP server failed to start",
    "config-invalid": ".github/lsp.json is invalid JSON",
    "fs-error": "Could not write LSP config",
};

const BODIES: Record<LspWarning["kind"], string> = {
    missing:
        "The agent will work without precise code intelligence (find-references, definitions, diagnostics) until you install a TypeScript LSP server.",
    broken:
        "typescript-language-server is on PATH but failed when invoked with --version. The agent will run without LSP support.",
    "config-invalid":
        "Your existing .github/lsp.json could not be parsed as JSON. debug-gui left the file untouched. Fix the syntax and restart.",
    "fs-error":
        "debug-gui could not write .github/lsp.json (likely a filesystem permission issue). The agent will run without LSP support.",
};

export interface LspWarningModalProps {
    warning: LspWarning | null;
    onDismiss: () => void;
}

export function LspWarningModal({ warning, onDismiss }: LspWarningModalProps) {
    if (!warning) return null;
    const title = TITLES[warning.kind];
    const body = warning.message ?? BODIES[warning.kind];
    return (
        <EfDialog opened header={title} onCancel={onDismiss}>
            <div className="flex flex-col gap-3 max-w-xl">
                <h2 className="text-base font-semibold">{title}</h2>
                <p className="text-sm">{body}</p>
                {warning.installCmd ? (
                    <pre className="text-xs bg-black/40 p-2 rounded select-all overflow-x-auto">
                        {warning.installCmd}
                    </pre>
                ) : null}
                {warning.stderrTail ? (
                    <pre className="text-xs bg-black/40 p-2 rounded max-h-40 overflow-auto">
                        {warning.stderrTail}
                    </pre>
                ) : null}
                <p className="text-xs opacity-70">
                    Restart debug-gui after fixing to retry detection.
                </p>
                <div className="flex justify-end">
                    <EfButton onClick={onDismiss}>Dismiss</EfButton>
                </div>
            </div>
        </EfDialog>
    );
}
