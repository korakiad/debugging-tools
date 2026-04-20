import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestTree } from "./TestTree";

describe("TestTree", () => {
    it("renders suites and fires onRun when clicked", () => {
        const onRun = vi.fn();
        render(
            <TestTree
                suites={[{ relPath: "test/a.spec.js", absPath: "/x/a.spec.js" }]}
                onRun={onRun}
            />
        );
        const button = screen.getByText("test/a.spec.js");
        fireEvent.click(button);
        expect(onRun).toHaveBeenCalledWith("test/a.spec.js");
    });
});
