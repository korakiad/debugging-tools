import { useEffect, useRef } from "react";
import type { LogRow as LogRowData } from "./deriveLog";
import { LogRow } from "./LogRow";

interface LogTableProps {
    rows: LogRowData[];
    truncated?: boolean;
    onSelfHealRow?: (row: LogRowData) => React.ReactNode;
}

export function LogTable({ rows, truncated, onSelfHealRow }: LogTableProps) {
    const ref = useRef<HTMLDivElement | null>(null);

    // Auto-scroll-to-bottom on new rows. We only follow if the user is
    // already near the bottom — otherwise scrolling away to read older
    // lines while the run pours new lines in is intolerable.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 64) {
            el.scrollTop = el.scrollHeight;
        }
    }, [rows.length]);

    if (rows.length === 0) {
        return (
            <div className="log-table-empty" role="status">
                Run a test to see the live log here.
            </div>
        );
    }

    return (
        <div className="log-table" role="table" aria-label="run log">
            <div className="log-table-head" role="row">
                <span role="columnheader">TIME</span>
                <span role="columnheader">LEVEL</span>
                <span role="columnheader">STEP</span>
                <span role="columnheader">EVENT</span>
            </div>
            <div className="log-table-body" ref={ref} role="rowgroup">
                {truncated && (
                    <div className="log-table-truncated" role="status">
                        Earlier lines truncated · scroll up in mocha output for full history.
                    </div>
                )}
                {rows.map((row) => {
                    if (row.level === "SELF-HEAL" && onSelfHealRow) {
                        return (
                            <div key={row.id} className="log-table-heal-wrapper" role="row">
                                <LogRow row={row} />
                                {onSelfHealRow(row)}
                            </div>
                        );
                    }
                    return <LogRow key={row.id} row={row} />;
                })}
            </div>
        </div>
    );
}
