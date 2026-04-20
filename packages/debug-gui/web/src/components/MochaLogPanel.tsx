import { useEffect, useRef } from "react";
import { useStore } from "../state/store";

export function MochaLogPanel() {
    const log = useStore((s) => s.mochaLog);
    const exitCode = useStore((s) => s.mochaExitCode);
    const ref = useRef<HTMLPreElement | null>(null);

    useEffect(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    }, [log.length]);

    if (log.length === 0 && exitCode === undefined) return null;

    return (
        <section className="border rounded bg-gray-900 text-gray-100">
            <header className="flex justify-between items-center px-3 py-1 text-xs border-b border-gray-700">
                <span>Mocha output</span>
                {exitCode !== undefined && exitCode !== null && (
                    <span className={exitCode === 0 ? "text-green-400" : "text-red-400"}>
                        exit {exitCode}
                    </span>
                )}
            </header>
            <pre
                ref={ref}
                className="text-xs p-3 max-h-64 overflow-auto whitespace-pre-wrap font-mono leading-relaxed"
            >
                {log.map((line, i) => (
                    <span key={i} className={line.stream === "stderr" ? "text-red-300" : undefined}>
                        {line.text}
                    </span>
                ))}
            </pre>
        </section>
    );
}
