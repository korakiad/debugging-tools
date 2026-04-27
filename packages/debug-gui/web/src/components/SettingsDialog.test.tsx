import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsDialog, parseExtensionsInput } from "./SettingsDialog";

describe("SettingsDialog", () => {
    it("does not render when open=false", () => {
        const { container } = render(
            <SettingsDialog open={false} config={{}} onSave={() => {}} onClose={() => {}} />
        );
        expect(container.innerHTML).toBe("");
    });

    it("seeds inputs from config when opened", () => {
        render(
            <SettingsDialog
                open
                config={{
                    discovery: { globs: ["test/**/*.spec.ts"], exclude: ["dist/**"] },
                    agent: { idleTimeoutMs: 5 * 60 * 1000 },
                }}
                onSave={() => {}}
                onClose={() => {}}
            />
        );
        expect((screen.getByLabelText("glob 1") as HTMLInputElement).value).toBe("test/**/*.spec.ts");
        expect((screen.getByLabelText("exclude 1") as HTMLInputElement).value).toBe("dist/**");
        expect((screen.getByLabelText("idle timeout minutes") as HTMLInputElement).value).toBe("5");
    });

    it("Save is disabled when nothing has changed", () => {
        render(
            <SettingsDialog
                open
                config={{ discovery: { globs: ["a"], exclude: [] }, agent: { idleTimeoutMs: 600000 } }}
                onSave={() => {}}
                onClose={() => {}}
            />
        );
        expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    });

    it("emits patch containing only changed fields", () => {
        const onSave = vi.fn();
        render(
            <SettingsDialog
                open
                config={{ discovery: { globs: ["a"], exclude: [] }, agent: { idleTimeoutMs: 600000 } }}
                onSave={onSave}
                onClose={() => {}}
            />
        );
        fireEvent.change(screen.getByLabelText("idle timeout minutes"), { target: { value: "2" } });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
        expect(onSave).toHaveBeenCalledWith({ idleTimeoutMs: 2 * 60 * 1000 });
    });

    it("adding a glob row and saving emits the new list in discovery.globs", () => {
        const onSave = vi.fn();
        render(
            <SettingsDialog
                open
                config={{ discovery: { globs: ["a"], exclude: [] }, agent: { idleTimeoutMs: 600000 } }}
                onSave={onSave}
                onClose={() => {}}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: /add glob/i }));
        fireEvent.change(screen.getByLabelText("glob 2"), { target: { value: "b" } });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
        expect(onSave).toHaveBeenCalledWith({ discovery: { globs: ["a", "b"] } });
    });

    it("removing an exclude row emits the shortened list in discovery.exclude", () => {
        const onSave = vi.fn();
        render(
            <SettingsDialog
                open
                config={{ discovery: { globs: ["a"], exclude: ["x", "y"] }, agent: { idleTimeoutMs: 600000 } }}
                onSave={onSave}
                onClose={() => {}}
            />
        );
        fireEvent.click(screen.getByLabelText(/remove exclude 1/i));
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
        expect(onSave).toHaveBeenCalledWith({ discovery: { exclude: ["y"] } });
    });

    it("Save stays disabled when idle minutes is below 1", () => {
        render(
            <SettingsDialog
                open
                config={{ discovery: { globs: [], exclude: [] }, agent: { idleTimeoutMs: 600000 } }}
                onSave={() => {}}
                onClose={() => {}}
            />
        );
        fireEvent.change(screen.getByLabelText("idle timeout minutes"), { target: { value: "0" } });
        expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
        expect(screen.getByText(/at least 1 minute/i)).toBeInTheDocument();
    });

    it("clicking Cancel calls onClose without onSave", () => {
        const onSave = vi.fn();
        const onClose = vi.fn();
        render(
            <SettingsDialog open config={{}} onSave={onSave} onClose={onClose} />
        );
        fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
        expect(onClose).toHaveBeenCalled();
        expect(onSave).not.toHaveBeenCalled();
    });

    it("seeds the extensions field from config.discovery.extensions", () => {
        render(
            <SettingsDialog
                open
                config={{ discovery: { extensions: ["js", "ts"] } }}
                onSave={() => {}}
                onClose={() => {}}
            />
        );
        expect((screen.getByLabelText("extensions") as HTMLInputElement).value).toBe("js, ts");
    });

    it("emits parsed extensions in the patch on save", () => {
        const onSave = vi.fn();
        render(
            <SettingsDialog
                open
                config={{ discovery: { globs: ["a"], exclude: [] }, agent: { idleTimeoutMs: 600000 } }}
                onSave={onSave}
                onClose={() => {}}
            />
        );
        fireEvent.change(screen.getByLabelText("extensions"), { target: { value: "js, .ts,  tsx" } });
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
        expect(onSave).toHaveBeenCalledWith({
            discovery: { extensions: ["js", "ts", "tsx"] },
        });
    });

    it("shows a preview of the effective extension pattern", () => {
        render(
            <SettingsDialog open config={{}} onSave={() => {}} onClose={() => {}} />
        );
        fireEvent.change(screen.getByLabelText("extensions"), { target: { value: "js" } });
        expect(screen.getByText(/Will be applied as/).textContent).toContain(".js");

        fireEvent.change(screen.getByLabelText("extensions"), { target: { value: "js, ts" } });
        expect(screen.getByText(/Will be applied as/).textContent).toContain(".{js,ts}");
    });

    it("shows a 'no patterns yet' hint when a glob list is empty", () => {
        render(
            <SettingsDialog
                open
                config={{ discovery: { globs: [], exclude: [] } }}
                onSave={() => {}}
                onClose={() => {}}
            />
        );
        // Two empty lists → two hints (one above globs, one above excludes).
        expect(screen.getAllByText(/no patterns yet/i).length).toBe(2);
    });

    it("hides the 'no patterns yet' hint after the user adds a row", () => {
        render(
            <SettingsDialog
                open
                config={{ discovery: { globs: [], exclude: ["x"] } }}
                onSave={() => {}}
                onClose={() => {}}
            />
        );
        // Only the empty glob list shows the hint.
        expect(screen.getAllByText(/no patterns yet/i).length).toBe(1);
        fireEvent.click(screen.getByRole("button", { name: /add glob/i }));
        expect(screen.queryByText(/no patterns yet/i)).not.toBeInTheDocument();
    });
});

describe("parseExtensionsInput", () => {
    it("splits, trims, strips leading dots, and drops dupes", () => {
        expect(parseExtensionsInput(" .js, ts , ts ,  jsx  "))
            .toEqual(["js", "ts", "jsx"]);
    });
    it("returns [] for blank input", () => {
        expect(parseExtensionsInput("   ,  ,  ")).toEqual([]);
    });
});
