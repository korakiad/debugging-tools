import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Stub the websocket hook so App doesn't try to open a real connection.
// Use vi.hoisted so sendSpy is available to the hoisted vi.mock factory.
const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn() }));
vi.mock("./hooks/useWebSocket", () => ({
    useWebSocket: () => ({ send: sendSpy }),
}));

import App from "./App";
import { useStore } from "./state/store";

describe("App empty-state integration", () => {
    it("opens the SettingsDialog when the TestTree empty-state Open Settings button is clicked", () => {
        render(<App />);
        // Pre-click: the modal dialog is not in the DOM.
        expect(screen.queryByRole("dialog", { name: /settings/i })).not.toBeInTheDocument();

        // Click the empty-state nudge button (text "Open Settings ⚙").
        fireEvent.click(screen.getByRole("button", { name: /open settings/i }));

        // Post-click: the modal dialog is mounted.
        expect(screen.getByRole("dialog", { name: /settings/i })).toBeInTheDocument();
    });
});

describe("App suite-switch confirmation", () => {
    beforeEach(() => {
        sendSpy.mockReset();
        // Reset store to a known idle state with two discoverable suites.
        useStore.setState({
            suites: [
                { relPath: "test/a.spec.js", absPath: "/x/a.spec.js" },
                { relPath: "test/b.spec.js", absPath: "/x/b.spec.js" },
            ],
            selectedSpec: "test/a.spec.js",
            selectedNode: null,
            state: { state: "idle" },
            suiteTrees: {},
            config: {},
        });
    });

    it("idle: clicking another suite applies immediately, no dialog", () => {
        render(<App />);
        // Sanity: dialog not present.
        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("test/b.spec.js"));

        expect(useStore.getState().selectedSpec).toBe("test/b.spec.js");
        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
    });

    it("running: clicking another suite opens confirm dialog and does NOT change selection", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));

        // Dialog mounted.
        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        // Selection not changed yet.
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
    });

    it("running: clicking the current selection is a no-op (no dialog)", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        // Role-based query disambiguates the sidebar button from the selection echo in the main pane.
        fireEvent.click(screen.getByRole("button", { name: "test/a.spec.js" }));

        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
    });

    it("running: clicking 'Keep running' closes dialog, does NOT send cancel, leaves selection", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));
        fireEvent.click(screen.getByRole("button", { name: /keep running/i }));

        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
        expect(sendSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: "cancel" }));
    });

    it("running: clicking 'Switch' sends cancel, shows 'Stopping…', does NOT yet swap selection", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));
        fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

        expect(sendSpy).toHaveBeenCalledWith({ type: "cancel" });
        // Dialog still open, but in switching phase.
        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        expect(screen.getByText(/stopping current run/i)).toBeInTheDocument();
        // Buttons gone.
        expect(screen.queryByRole("button", { name: /^switch$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /keep running/i })).not.toBeInTheDocument();
        // Selection unchanged.
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
    });

    it("paused: clicking another suite opens confirm dialog", () => {
        useStore.setState({ state: { state: "paused" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));

        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
    });

    it("after Switch: when status flips to idle, pendingSelection is applied and dialog closes", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));
        fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

        // Simulate the server broadcasting status:idle (cancel landed).
        act(() => {
            useStore.getState().applyEvent({ type: "status", state: "idle" });
        });

        expect(useStore.getState().selectedSpec).toBe("test/b.spec.js");
        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
    });
});
