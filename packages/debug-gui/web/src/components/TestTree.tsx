interface Suite {
    relPath: string;
    absPath: string;
}

export function TestTree({
    suites,
    selectedSpec,
    onSelect,
}: {
    suites: Suite[];
    selectedSpec: string | null;
    onSelect: (relPath: string) => void;
}) {
    return (
        <nav className="w-64 border-r h-full overflow-auto p-2">
            <h2 className="text-sm font-bold mb-2">Test Suites</h2>
            <ul className="space-y-1">
                {suites.map((s) => {
                    const isSelected = s.relPath === selectedSpec;
                    return (
                        <li key={s.relPath}>
                            <button
                                type="button"
                                className={`suite-row${isSelected ? " suite-row-selected" : ""}`}
                                aria-pressed={isSelected}
                                onClick={() => onSelect(s.relPath)}
                            >
                                {s.relPath}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
