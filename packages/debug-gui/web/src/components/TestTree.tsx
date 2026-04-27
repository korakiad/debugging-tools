interface Suite {
    relPath: string;
    absPath: string;
}

export function TestTree({
    suites,
    selectedSpec,
    onSelect,
    onOpenSettings,
    settingsDisabled,
}: {
    suites: Suite[];
    selectedSpec: string | null;
    onSelect: (relPath: string) => void;
    onOpenSettings?: () => void;
    settingsDisabled?: boolean;
}) {
    return (
        <nav className="w-64 border-r h-full overflow-auto p-2">
            <h2 className="text-sm font-bold mb-2">Test Suites</h2>
            {suites.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm">
                    <p className="opacity-70 mb-1">Looks like there are no test files yet.</p>
                    <p className="opacity-60 text-xs mb-3">
                        Configure where to find them in Settings.
                    </p>
                    {onOpenSettings && (
                        <button
                            type="button"
                            onClick={onOpenSettings}
                            disabled={settingsDisabled}
                            className="px-3 py-1 rounded border border-gray-600 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Open Settings ⚙
                        </button>
                    )}
                </div>
            ) : (
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
            )}
        </nav>
    );
}
