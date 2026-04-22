import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestTree } from "./TestTree";

describe("TestTree", () => {
    it("renders suites and fires onSelect when clicked", () => {
        const onSelect = vi.fn();
        render(
            <TestTree
                suites={[{ relPath: "test/a.spec.js", absPath: "/x/a.spec.js" }]}
                selectedSpec={null}
                onSelect={onSelect}
            />
        );
        const button = screen.getByText("test/a.spec.js");
        fireEvent.click(button);
        expect(onSelect).toHaveBeenCalledWith("test/a.spec.js");
    });

    it("marks the selected suite with aria-pressed", () => {
        render(
            <TestTree
                suites={[
                    { relPath: "test/a.spec.js", absPath: "/x/a.spec.js" },
                    { relPath: "test/b.spec.js", absPath: "/x/b.spec.js" },
                ]}
                selectedSpec="test/b.spec.js"
                onSelect={() => {}}
            />
        );
        expect(screen.getByText("test/a.spec.js")).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByText("test/b.spec.js")).toHaveAttribute("aria-pressed", "true");
    });
});
