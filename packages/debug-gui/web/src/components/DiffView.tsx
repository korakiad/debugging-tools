import ReactDiffViewer from "react-diff-viewer-continued";

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
        <div className="border rounded">
            <div className="text-xs p-2 bg-gray-50 border-b">{file}</div>
            <ReactDiffViewer oldValue={oldCode} newValue={newCode} splitView={false} />
            <div className="p-2 flex gap-2 justify-end border-t">
                <button className="bg-red-500 text-white px-3 py-1 rounded" onClick={onReject}>
                    Reject
                </button>
                <button className="bg-green-600 text-white px-3 py-1 rounded" onClick={onApprove}>
                    Approve
                </button>
            </div>
        </div>
    );
}
