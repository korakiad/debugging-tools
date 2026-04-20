import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffView } from "./DiffView";

describe("DiffView", () => {
    it("fires onApprove/onReject", () => {
        const onApprove = vi.fn();
        const onReject = vi.fn();
        render(
            <DiffView
                file="a.js"
                oldCode="old"
                newCode="new"
                onApprove={onApprove}
                onReject={onReject}
            />
        );
        fireEvent.click(screen.getByText(/approve/i));
        expect(onApprove).toHaveBeenCalled();
        fireEvent.click(screen.getByText(/reject/i));
        expect(onReject).toHaveBeenCalled();
    });
});
