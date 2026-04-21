import { EfButton } from "../ui";

export function PickerOverlay({
    imageUrl,
    hint,
    onPick,
    onCancel,
}: {
    imageUrl: string;
    hint: string;
    onPick: (coords: { x: number; y: number }) => void;
    onCancel: () => void;
}) {
    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex flex-col items-center p-4"
            style={{ background: "rgba(0,0,0,0.8)" }}
        >
            <div className="flex justify-between items-center w-full max-w-4xl mb-2" style={{ color: "var(--ef-primary)" }}>
                <span>Click the element: "{hint}"</span>
                <EfButton transparent onClick={onCancel}>
                    Cancel
                </EfButton>
            </div>
            <img
                alt="page"
                src={imageUrl}
                className="cursor-crosshair"
                style={{ maxHeight: "80vh" }}
                onClick={(e) => onPick({ x: e.clientX, y: e.clientY })}
            />
        </div>
    );
}
