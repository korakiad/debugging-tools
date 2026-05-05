import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PickerOverlay } from "./PickerOverlay";

describe("PickerOverlay", () => {
    it("shows the hint and instructs QA to click in the test browser", () => {
        render(<PickerOverlay hint="login button" onCancel={() => {}} />);
        expect(
            screen.getByText(/click in the test browser/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/login button/)).toBeInTheDocument();
    });

    it("calls onCancel when Cancel is clicked", () => {
        const onCancel = vi.fn();
        render(<PickerOverlay hint="x" onCancel={onCancel} />);
        fireEvent.click(screen.getByText("Cancel"));
        expect(onCancel).toHaveBeenCalled();
    });
});
