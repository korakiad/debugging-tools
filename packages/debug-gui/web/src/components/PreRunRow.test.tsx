import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PreRunRow } from "./PreRunRow";
import { setEfChecked, setEfValue } from "../test-utils/ef-events";

describe("PreRunRow", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("renders saved preRun value in the input", async () => {
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} />);
        const input = screen.getByLabelText(/pre-run/i) as unknown as { value: string };
        await waitFor(() => expect(input.value).toBe("npm run build"));
    });

    it("Save is disabled when input equals saved value", async () => {
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} />);
        await waitFor(() =>
            expect(screen.getByRole("button", { name: /save/i })).toBeDisabled(),
        );
    });

    it("Save becomes enabled when input changes", async () => {
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} />);
        const input = screen.getByLabelText(/pre-run/i);
        setEfValue(input, "npm run build:dev");
        await waitFor(() =>
            expect(screen.getByRole("button", { name: /save/i })).toBeEnabled(),
        );
    });

    it("clicking Save calls onSave with the input value", async () => {
        const onSave = vi.fn();
        render(<PreRunRow saved="old" onSave={onSave} onSkipChange={() => {}} skip={false} disabled={false} />);
        const input = screen.getByLabelText(/pre-run/i);
        setEfValue(input, "new");
        await waitFor(() =>
            expect(screen.getByRole("button", { name: /save/i })).toBeEnabled(),
        );
        fireEvent.click(screen.getByRole("button", { name: /save/i }));
        expect(onSave).toHaveBeenCalledWith("new");
    });

    it("toggling Skip checkbox calls onSkipChange", () => {
        const onSkipChange = vi.fn();
        render(<PreRunRow saved="npm run build" onSave={() => {}} onSkipChange={onSkipChange} skip={false} disabled={false} />);
        setEfChecked(screen.getByLabelText(/skip/i), true);
        expect(onSkipChange).toHaveBeenCalledWith(true);
    });

    it("reports dirty state via onDirtyChange", () => {
        const onDirty = vi.fn();
        render(<PreRunRow saved="a" onSave={() => {}} onSkipChange={() => {}} skip={false} disabled={false} onDirtyChange={onDirty} />);
        setEfValue(screen.getByLabelText(/pre-run/i), "b");
        expect(onDirty).toHaveBeenCalledWith(true);
    });
});
