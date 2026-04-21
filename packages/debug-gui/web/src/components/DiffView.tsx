import ReactDiffViewer from "react-diff-viewer-continued";
import { EfButton, EfPanel } from "../ui";

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
    return (
        <EfPanel style={{ display: "block" }}>
            <div className="text-xs p-2 opacity-70" style={{ borderBottom: "1px solid var(--ef-border-color)" }}>
                {file}
            </div>
            <ReactDiffViewer oldValue={oldCode} newValue={newCode} splitView={false} useDarkTheme />
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
