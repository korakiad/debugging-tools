import type { LogLevel, LogRow as LogRowData } from "./deriveLog";
import { formatTime } from "./deriveLog";

const LEVEL_TOKEN: Record<LogLevel, { color: string; bg: string }> = {
    SYS:        { color: "var(--ef-content-secondary-color, #8a96a4)", bg: "rgba(138, 150, 164, 0.12)" },
    INFO:       { color: "var(--ef-primary, #1675e0)",                  bg: "rgba(22, 117, 224, 0.14)" },
    PASS:       { color: "var(--ef-success, #4caf50)",                  bg: "rgba(76, 175, 80, 0.14)" },
    FAIL:       { color: "var(--ef-error, #f44336)",                    bg: "rgba(244, 67, 54, 0.18)" },
    WARN:       { color: "var(--ef-warning, #ffb74d)",                  bg: "rgba(255, 183, 77, 0.18)" },
    "SELF-HEAL":{ color: "var(--ef-info, #4dd0e1)",                     bg: "rgba(77, 208, 225, 0.18)" },
};

export function LogRow({ row }: { row: LogRowData }) {
    const tone = LEVEL_TOKEN[row.level];
    return (
        <div className="log-row" data-level={row.level}>
            <span className="log-row-time">{formatTime(row.timeMs)}</span>
            <span
                className="log-row-level"
                style={{ color: tone.color, background: tone.bg }}
            >
                {row.level}
            </span>
            <span className="log-row-step">
                {row.step ?? "—"}
            </span>
            <span className="log-row-event">{row.text}</span>
        </div>
    );
}
