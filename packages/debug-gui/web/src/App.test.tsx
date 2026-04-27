import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Stub the websocket hook so App doesn't try to open a real connection.
vi.mock("./hooks/useWebSocket", () => ({
    useWebSocket: () => ({ send: vi.fn() }),
}));

import App from "./App";

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
