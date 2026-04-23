import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreRunRow } from "./PreRunRow";

describe("PreRunRow", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("renders saved preRun value in the input", () => {
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} />);
        const input = screen.getByLabelText(/pre-run/i) as HTMLInputElement;
        expect(input.value).toBe("npm run build");
    });

    it("Save is disabled when input equals saved value", () => {
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} />);
        const save = screen.getByRole("button", { name: /save/i });
        expect(save).toBeDisabled();
    });

    it("Save becomes enabled when input changes", () => {
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} />);
        const input = screen.getByLabelText(/pre-run/i);
        fireEvent.change(input, { target: { value: "npm run build:dev" } });
        expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
    });

    it("clicking Save calls onSave with the input value", () => {
        const onSave = vi.fn();
        render(<PreRunRow saved="old" onSave={onSave} onSkipChange={() => {}} skip={false} disabled={false} />);
        const input = screen.getByLabelText(/pre-run/i);
        fireEvent.change(input, { target: { value: "new" } });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith("new");
    });

    it("toggling Skip checkbox calls onSkipChange", () => {
        const onSkipChange = vi.fn();
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={onSkipChange} skip={false} disabled={false} />);
        fireEvent.click(screen.getByLabelText(/skip/i));
        expect(onSkipChange).toHaveBeenCalledWith(true);
    });

    it("reports dirty state via onDirtyChange", () => {
        const onDirty = vi.fn();
        render(<PreRunRow saved="a" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} onDirtyChange={onDirty} />);
        fireEvent.change(screen.getByLabelText(/pre-run/i), { target: { value: "b" } });
        expect(onDirty).toHaveBeenCalledWith(true);
    });
});
