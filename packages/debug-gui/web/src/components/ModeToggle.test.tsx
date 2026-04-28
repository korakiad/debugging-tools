import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeToggle } from "./ModeToggle";

describe("ModeToggle", () => {
    it("renders Auto and Manual buttons with active state", () => {
        render(<ModeToggle mode="auto" disabled={false} onChange={() => {}} />);
        expect(screen.getByText("Auto")).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByText("Manual")).toHaveAttribute("aria-pressed", "false");
    });

    it("fires onChange when clicking the inactive option", () => {
        const onChange = vi.fn();
        render(<ModeToggle mode="auto" disabled={false} onChange={onChange} />);
        fireEvent.click(screen.getByText("Manual"));
        expect(onChange).toHaveBeenCalledWith("manual");
    });

    it("does not fire onChange when clicking the already-active option", () => {
        const onChange = vi.fn();
        render(<ModeToggle mode="auto" disabled={false} onChange={onChange} />);
        fireEvent.click(screen.getByText("Auto"));
        expect(onChange).not.toHaveBeenCalled();
    });

    it("disables both buttons when disabled prop is true", () => {
        render(<ModeToggle mode="auto" disabled={true} onChange={() => {}} />);
        expect(screen.getByText("Auto")).toBeDisabled();
        expect(screen.getByText("Manual")).toBeDisabled();
    });
});
