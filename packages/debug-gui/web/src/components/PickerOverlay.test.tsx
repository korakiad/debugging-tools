import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PickerOverlay } from "./PickerOverlay";

describe("PickerOverlay", () => {
    it("calls onPick with click coordinates", () => {
        const onPick = vi.fn();
        render(<PickerOverlay imageUrl="/shot.png" hint="button" onPick={onPick} onCancel={() => {}} />);
        const img = screen.getByAltText("page");
        fireEvent.click(img, { clientX: 120, clientY: 240 });
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ x: 120, y: 240 }));
    });
});
