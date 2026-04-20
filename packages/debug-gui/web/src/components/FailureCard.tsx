interface Failure {
    test: string;
    file: string;
    error: string;
    stack: string;
}

export function FailureCard({ failure }: { failure: Failure }) {
    return (
        <div className="border rounded p-4 bg-red-50 space-y-2">
            <div className="font-bold text-red-700">{failure.test}</div>
            <div className="text-sm text-gray-600">{failure.file}</div>
            <pre className="text-xs bg-white p-2 rounded whitespace-pre-wrap">{failure.error}</pre>
            {failure.stack && (
                <details>
                    <summary className="text-xs cursor-pointer">Stack trace</summary>
                    <pre className="text-xs bg-white p-2 rounded mt-1">{failure.stack}</pre>
                </details>
            )}
        </div>
    );
}
