import { EfPanel } from "../ui";

interface Failure {
    test: string;
    file: string;
    error: string;
    stack: string;
}

export function FailureCard({ failure }: { failure: Failure }) {
    return (
        <EfPanel spacing style={{ display: "block", borderLeft: "3px solid var(--ef-error)" }}>
            <div className="font-bold" style={{ color: "var(--ef-error)" }}>
                {failure.test}
            </div>
            <div className="text-sm opacity-70">{failure.file}</div>
            <pre className="text-xs p-2 rounded whitespace-pre-wrap mt-2" style={{ background: "var(--ef-content-primary-background-color)" }}>
                {failure.error}
            </pre>
            {failure.stack && (
                <details className="mt-2">
                    <summary className="text-xs cursor-pointer">Stack trace</summary>
                    <pre className="text-xs p-2 rounded mt-1" style={{ background: "var(--ef-content-primary-background-color)" }}>
                        {failure.stack}
                    </pre>
                </details>
            )}
        </EfPanel>
    );
}
