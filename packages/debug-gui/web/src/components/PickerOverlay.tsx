import { EfButton } from "../ui";
import { Spinner } from "./Spinner";

export function PickerOverlay({
    hint,
    onCancel,
}: {
    hint: string;
    onCancel: () => void;
}) {
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Pick mode active"
            className="fixed inset-x-0 top-0 z-50 flex items-center gap-3 px-4 py-3"
            style={{ background: "var(--ef-info-color, #1f4f8b)", color: "#fff" }}
        >
            <Spinner />
            <div className="flex-1">
                <div className="font-semibold">Pick mode active — click in the test browser</div>
                <div className="text-sm opacity-80">Hint: "{hint}"</div>
            </div>
            <EfButton transparent onClick={onCancel}>
                Cancel
            </EfButton>
        </div>
    );
}
