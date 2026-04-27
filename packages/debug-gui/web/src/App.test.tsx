import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub the websocket hook so App doesn't try to open a real connection.
vi.mock("./hooks/useWebSocket", () => ({
    useWebSocket: () => ({ send: vi.fn() }),
}));

import App from "./App";
import { useStore } from "./state/store";

describe("App empty-state integration", () => {
    beforeEach(() => {
        // Reset to defaults: suites empty, state idle.
        useStore.setState({
            suites: [],
            selectedSpec: null,
            state: { state: "idle" },
            config: {},
        });
    });

    it("opens the SettingsDialog when the TestTree empty-state Open Settings button is clicked", () => {
        render(<App />);
        // Pre-click: dialog is not in the DOM.
        expect(screen.queryByRole("heading", { name: /^settings$/i })).not.toBeInTheDocument();

        // Click the empty-state nudge button (text "Open Settings ⚙").
        fireEvent.click(screen.getByRole("button", { name: /open settings/i }));

        // Post-click: SettingsDialog is mounted and visible (its heading exists).
        expect(screen.getByRole("heading", { name: /^settings$/i })).toBeInTheDocument();
    });
});
