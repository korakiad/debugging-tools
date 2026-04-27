import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionPanel } from "./SelectionPanel";

describe("SelectionPanel", () => {
    it("nudges the user when nothing is selected", () => {
        render(<SelectionPanel spec={null} node={null} />);
        expect(screen.getByText(/pick a suite, describe, or test/i)).toBeInTheDocument();
    });

    it("shows the spec path and 'whole file' helper when no node is selected", () => {
        render(<SelectionPanel spec="test/login.spec.js" node={null} />);
        expect(screen.getByTestId("selection-spec")).toHaveTextContent("test/login.spec.js");
        expect(screen.getByTestId("selection-whole")).toHaveTextContent(/whole file/i);
    });

    it("shows kind badge and fullTitle for an it node", () => {
        render(
            <SelectionPanel
                spec="test/login.spec.js"
                node={{ kind: "it", fullTitle: "Login Form should click the submit button" }}
            />
        );
        const node = screen.getByTestId("selection-node");
        expect(node).toHaveTextContent("it");
        expect(node).toHaveTextContent("Login Form should click the submit button");
    });

    it("shows kind badge for a describe node", () => {
        render(
            <SelectionPanel
                spec="test/login.spec.js"
                node={{ kind: "describe", fullTitle: "Login Form" }}
            />
        );
        const node = screen.getByTestId("selection-node");
        expect(node).toHaveTextContent("describe");
        expect(node).toHaveTextContent("Login Form");
    });

    it("renders a 'Run whole file' button only when a sub-node is selected and onClear is provided", () => {
        const onClear = vi.fn();
        const { rerender } = render(
            <SelectionPanel
                spec="test/login.spec.js"
                node={{ kind: "it", fullTitle: "x" }}
                onClear={onClear}
            />
        );
        const btn = screen.getByRole("button", { name: /run whole file/i });
        fireEvent.click(btn);
        expect(onClear).toHaveBeenCalledTimes(1);

        rerender(<SelectionPanel spec="test/login.spec.js" node={null} onClear={onClear} />);
        expect(screen.queryByRole("button", { name: /run whole file/i })).not.toBeInTheDocument();
    });
});
