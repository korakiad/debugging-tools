export function Spinner({ size = 16 }: { size?: number }) {
    const s = `${size}px`;
    return (
        <span
            role="status"
            aria-label="loading"
            className="inline-block animate-spin rounded-full"
            style={{
                width: s,
                height: s,
                border: "2px solid rgba(255,255,255,0.18)",
                borderTopColor: "var(--ef-primary, #1429bd)",
            }}
        />
    );
}
