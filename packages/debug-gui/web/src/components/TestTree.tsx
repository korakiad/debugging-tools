interface Suite {
    relPath: string;
    absPath: string;
}

export function TestTree({
    suites,
    onRun,
}: {
    suites: Suite[];
    onRun: (relPath: string) => void;
}) {
    return (
        <nav className="w-64 border-r h-full overflow-auto p-2">
            <h2 className="text-sm font-bold mb-2">Test Suites</h2>
            <ul>
                {suites.map((s) => (
                    <li key={s.relPath}>
                        <button
                            className="w-full text-left p-2 hover:bg-gray-100"
                            onClick={() => onRun(s.relPath)}
                        >
                            {s.relPath}
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
}
