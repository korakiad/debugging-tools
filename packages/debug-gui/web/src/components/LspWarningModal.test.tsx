import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LspWarningModal } from "./LspWarningModal";

describe("LspWarningModal", () => {
    it("renders nothing when warning is null", () => {
        const { container } = render(<LspWarningModal warning={null} onDismiss={() => {}} />);
        expect(container.firstChild).toBeNull();
    });

    it("renders missing variant with install command", () => {
        render(
            <LspWarningModal
                warning={{ kind: "missing", installCmd: "npm install -g typescript-language-server" }}
                onDismiss={() => {}}
            />,
        );
        expect(screen.getByText(/LSP server not installed/i)).toBeInTheDocument();
        expect(screen.getByText(/npm install -g typescript-language-server/)).toBeInTheDocument();
        expect(screen.getByText(/Restart debug-gui after fixing/i)).toBeInTheDocument();
    });

    it("renders broken variant with stderr tail", () => {
        render(
            <LspWarningModal
                warning={{
                    kind: "broken",
                    stderrTail: "EACCES: permission denied",
                    installCmd: "npm install -g typescript-language-server",
                }}
                onDismiss={() => {}}
            />,
        );
        expect(screen.getByText(/LSP server failed to start/i)).toBeInTheDocument();
        expect(screen.getByText(/EACCES: permission denied/)).toBeInTheDocument();
    });

    it("calls onDismiss when Dismiss is clicked", () => {
        const onDismiss = vi.fn();
        render(
            <LspWarningModal warning={{ kind: "missing", installCmd: "x" }} onDismiss={onDismiss} />,
        );
        fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
        expect(onDismiss).toHaveBeenCalledOnce();
    });
});
