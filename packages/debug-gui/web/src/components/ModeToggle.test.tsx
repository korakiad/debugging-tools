import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeToggle } from "./ModeToggle";

describe("ModeToggle", () => {
    it("renders Auto and Manual buttons", () => {
        render(<ModeToggle mode="auto" disabled={false} onChange={() => {}} />);
        expect(screen.getByText("Auto")).toBeInTheDocument();
        expect(screen.getByText("Manual")).toBeInTheDocument();
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
        expect(screen.getByText("Auto")).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByText("Manual")).toHaveAttribute("aria-disabled", "true");
    });

    it("does not fire onChange when disabled and inactive option is clicked", () => {
        const onChange = vi.fn();
        render(<ModeToggle mode="auto" disabled={true} onChange={onChange} />);
        fireEvent.click(screen.getByText("Manual"));
        expect(onChange).not.toHaveBeenCalled();
    });
});
