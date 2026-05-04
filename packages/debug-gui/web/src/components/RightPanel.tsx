import { useEffect, useRef, useState } from "react";
import { EfButton } from "../ui";

const STORAGE_KEY_WIDTH = "debug-gui:right-panel-width";
const STORAGE_KEY_COLLAPSED = "debug-gui:right-panel-collapsed";
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 320;
const MAX_WIDTH = 960;
const COLLAPSED_WIDTH = 36;

function readStoredWidth(): number {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY_WIDTH);
        const n = raw ? Number(raw) : NaN;
        if (!Number.isFinite(n)) return DEFAULT_WIDTH;
        return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
    } catch {
        return DEFAULT_WIDTH;
    }
}

function readStoredCollapsed(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY_COLLAPSED) === "true";
    } catch {
        return false;
    }
}

export function RightPanel({
    title = "Debug actions",
    children,
}: {
    title?: string;
    children: React.ReactNode;
}) {
    const [width, setWidth] = useState<number>(() => readStoredWidth());
    const [collapsed, setCollapsed] = useState<boolean>(() => readStoredCollapsed());
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

    // Persist width / collapsed state across reloads. Width writes are
    // throttled to drag-end; while dragging we keep state in memory only.
    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY_COLLAPSED, String(collapsed));
        } catch {
            // localStorage unavailable (private mode, embed) — non-fatal.
        }
    }, [collapsed]);

    const onResizerMouseDown = (e: React.MouseEvent) => {
        if (collapsed) return;
        e.preventDefault();
        dragRef.current = { startX: e.clientX, startWidth: width };
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";

        const onMove = (ev: MouseEvent) => {
            if (!dragRef.current) return;
            // Drag handle sits on the LEFT edge of the right panel; moving
            // the mouse leftward should grow the panel, so we subtract dx.
            const dx = dragRef.current.startX - ev.clientX;
            const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragRef.current.startWidth + dx));
            setWidth(next);
        };
        const onUp = () => {
            dragRef.current = null;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            // Persist whatever width we ended on. Reading from the closure
            // would be stale (onMove updates width via setWidth, not via
            // re-creating onUp), so we use the setState callback form to
            // read the latest value.
            setWidth((current) => {
                try {
                    window.localStorage.setItem(STORAGE_KEY_WIDTH, String(current));
                } catch {
                    /* localStorage unavailable; non-fatal */
                }
                return current;
            });
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    const onResizerKeyDown = (e: React.KeyboardEvent) => {
        if (collapsed) return;
        const step = e.shiftKey ? 48 : 16;
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            setWidth((w) => {
                const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w + step));
                try {
                    window.localStorage.setItem(STORAGE_KEY_WIDTH, String(next));
                } catch {
                    /* no-op */
                }
                return next;
            });
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setWidth((w) => {
                const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w - step));
                try {
                    window.localStorage.setItem(STORAGE_KEY_WIDTH, String(next));
                } catch {
                    /* no-op */
                }
                return next;
            });
        }
    };

    if (collapsed) {
        return (
            <aside
                className="right-panel right-panel-collapsed"
                style={{ width: COLLAPSED_WIDTH }}
                aria-label={title}
            >
                <EfButton
                    transparent
                    aria-label="Expand debug actions panel"
                    onClick={() => setCollapsed(false)}
                    className="right-panel-collapse-btn"
                >
                    ◀
                </EfButton>
            </aside>
        );
    }

    return (
        <aside
            className="right-panel"
            style={{ width }}
            aria-label={title}
        >
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize debug actions panel"
                tabIndex={0}
                className="right-panel-resizer"
                onMouseDown={onResizerMouseDown}
                onKeyDown={onResizerKeyDown}
            />
            <header className="right-panel-header">
                <span className="right-panel-title">{title}</span>
                <EfButton
                    transparent
                    aria-label="Collapse debug actions panel"
                    onClick={() => setCollapsed(true)}
                    className="right-panel-collapse-btn"
                >
                    ▶
                </EfButton>
            </header>
            <div className="right-panel-body">{children}</div>
        </aside>
    );
}
