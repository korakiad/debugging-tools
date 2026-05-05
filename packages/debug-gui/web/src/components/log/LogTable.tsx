import { Fragment, useEffect, useRef } from "react";
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

    // Plain `aria-label`'d region instead of role="table" / "row" /
    // "rowgroup" / "columnheader" / "cell": maintaining a valid grid tree
    // alongside the SELF-HEAL block (which would otherwise need its own
    // rowgroup) costs more than the screen-reader value of explicit
    // tabular semantics here. The visual layout is grid-driven CSS.
    return (
        <section className="log-table" aria-label="run log">
            <div className="log-table-head">
                <span>TIME</span>
                <span>LEVEL</span>
                <span>STEP</span>
                <span>EVENT</span>
            </div>
            <div className="log-table-body" ref={ref}>
                {truncated && (
                    <div className="log-table-truncated" role="status">
                        Earlier lines truncated · scroll up in mocha output for full history.
                    </div>
                )}
                {rows.map((row) => {
                    if (row.level === "SELF-HEAL" && onSelfHealRow) {
                        return (
                            <Fragment key={row.id}>
                                <LogRow row={row} />
                                {onSelfHealRow(row)}
                            </Fragment>
                        );
                    }
                    return <LogRow key={row.id} row={row} />;
                })}
            </div>
        </section>
    );
}
