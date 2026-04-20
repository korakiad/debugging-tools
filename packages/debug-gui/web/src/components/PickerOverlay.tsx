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
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center p-4">
            <div className="flex justify-between w-full max-w-4xl mb-2 text-white">
                <span>Click the element: "{hint}"</span>
                <button onClick={onCancel}>Cancel</button>
            </div>
            <img
                alt="page"
                src={imageUrl}
                className="max-h-[80vh] cursor-crosshair"
                onClick={(e) => onPick({ x: e.clientX, y: e.clientY })}
            />
        </div>
    );
}
