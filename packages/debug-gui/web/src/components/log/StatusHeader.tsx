import { useEffect, useState } from "react";
import type { SessionState } from "../../state/store";
import { formatTime } from "./deriveLog";

interface StatusHeaderProps {
    state: SessionState;
    startedAt: number | null;
    step: number;
    total: number;
}

const PILL: Record<SessionState, { label: string; tone: string }> = {
    idle: { label: "IDLE", tone: "var(--ef-content-secondary-color, #8a96a4)" },
    "pre-running": { label: "PRE-RUN", tone: "var(--ef-warning, #ffb74d)" },
    running: { label: "RUNNING", tone: "var(--ef-success, #4caf50)" },
    paused: { label: "PAUSED", tone: "var(--ef-warning, #ffb74d)" },
    done: { label: "DONE", tone: "var(--ef-info, #4dd0e1)" },
};

// 250ms tick is enough for "00:42.318"-style display. The clock only runs
// while the test is actively executing (running / pre-running). On paused
// (QA triaging a failure), idle, and done, the interval is cleared and
// `now` freezes at the value captured the moment state transitioned —
// which is what the second effect below ensures, so the displayed elapsed
// snaps to the transition instant rather than the previous tick.
function useElapsed(state: SessionState, startedAt: number | null): number {
    const [now, setNow] = useState<number>(() => Date.now());
    const ticking = (state === "running" || state === "pre-running") && startedAt != null;
    useEffect(() => {
        setNow(Date.now());
    }, [state]);
    useEffect(() => {
        if (!ticking) return;
        const id = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(id);
    }, [ticking]);
    if (startedAt == null) return 0;
    return Math.max(0, now - startedAt);
}

export function StatusHeader({ state, startedAt, step, total }: StatusHeaderProps) {
    const pill = PILL[state];
    const elapsed = useElapsed(state, startedAt);
    return (
        <div className="log-status-header" role="status" aria-live="polite">
            <div className="log-status-pill-group">
                <span className="log-status-label">STATUS</span>
                <span
                    className="log-status-pill"
                    style={{
                        borderColor: pill.tone,
                        color: pill.tone,
                    }}
                >
                    <span className="log-status-pill-dot" style={{ background: pill.tone }} aria-hidden />
                    {pill.label}
                </span>
            </div>
            <div className="log-status-meta">
                <span className="log-status-label">ELAPSED</span>
                <span className="log-status-value">{formatTime(elapsed)}</span>
            </div>
            <div className="log-status-meta">
                <span className="log-status-label">STEP</span>
                <span className="log-status-value">
                    {step}
                    <span className="log-status-step-divider">/</span>
                    {total > 0 ? total : "—"}
                </span>
            </div>
        </div>
    );
}
