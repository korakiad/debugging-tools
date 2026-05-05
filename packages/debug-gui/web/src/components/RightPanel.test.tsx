import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RightPanel } from "./RightPanel";

describe("RightPanel", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("renders children inside the body when expanded", () => {
        render(
            <RightPanel>
                <div data-testid="child">hello</div>
            </RightPanel>
        );
        expect(screen.getByTestId("child")).toBeInTheDocument();
        expect(screen.getByLabelText("Resize debug actions panel")).toBeInTheDocument();
    });

    it("collapses to a narrow strip and back via the toggle buttons", () => {
        render(
            <RightPanel>
                <div data-testid="child">hello</div>
            </RightPanel>
        );
        // Expanded → collapsed
        fireEvent.click(screen.getByLabelText("Collapse debug actions panel"));
        expect(screen.queryByTestId("child")).not.toBeInTheDocument();
        // Collapsed → expanded
        fireEvent.click(screen.getByLabelText("Expand debug actions panel"));
        expect(screen.getByTestId("child")).toBeInTheDocument();
    });

    it("persists the collapsed flag in localStorage", () => {
        const { unmount } = render(
            <RightPanel>
                <div>x</div>
            </RightPanel>
        );
        fireEvent.click(screen.getByLabelText("Collapse debug actions panel"));
        expect(window.localStorage.getItem("debug-gui:right-panel-collapsed")).toBe("true");
        unmount();
        // Remount: should boot collapsed.
        render(
            <RightPanel>
                <div data-testid="child2">y</div>
            </RightPanel>
        );
        expect(screen.queryByTestId("child2")).not.toBeInTheDocument();
        expect(screen.getByLabelText("Expand debug actions panel")).toBeInTheDocument();
    });

    it("restores the stored width on mount", () => {
        window.localStorage.setItem("debug-gui:right-panel-width", "612");
        render(
            <RightPanel>
                <div>x</div>
            </RightPanel>
        );
        const aside = screen.getByLabelText("Debug actions");
        expect((aside as HTMLElement).style.width).toBe("612px");
    });

    it("clamps stored widths to the [MIN_WIDTH, MAX_WIDTH] range", () => {
        window.localStorage.setItem("debug-gui:right-panel-width", "9999");
        render(
            <RightPanel>
                <div>x</div>
            </RightPanel>
        );
        const aside = screen.getByLabelText("Debug actions");
        // MAX_WIDTH = 960
        expect((aside as HTMLElement).style.width).toBe("960px");
    });

    it("supports keyboard width adjustment on the resizer", () => {
        window.localStorage.setItem("debug-gui:right-panel-width", "500");
        render(
            <RightPanel>
                <div>x</div>
            </RightPanel>
        );
        const resizer = screen.getByLabelText("Resize debug actions panel");
        // ArrowLeft should grow the panel by 16px (default step).
        fireEvent.keyDown(resizer, { key: "ArrowLeft" });
        const aside = screen.getByLabelText("Debug actions");
        expect((aside as HTMLElement).style.width).toBe("516px");
        // ArrowRight should shrink it.
        fireEvent.keyDown(resizer, { key: "ArrowRight" });
        fireEvent.keyDown(resizer, { key: "ArrowRight" });
        expect((aside as HTMLElement).style.width).toBe("484px");
    });
});
