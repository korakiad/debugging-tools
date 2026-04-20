export function Spinner({ size = 16 }: { size?: number }) {
    const s = `${size}px`;
    return (
        <span
            role="status"
            aria-label="loading"
            className="inline-block animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
            style={{ width: s, height: s }}
        />
    );
}
