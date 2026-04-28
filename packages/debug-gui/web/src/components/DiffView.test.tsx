import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffView } from "./DiffView";

// Pierre's <FileDiff> mounts a custom element (`FileDiffContainer`) that
// constructs adopted stylesheets via `new CSSStyleSheet()` + `replaceSync`.
// jsdom doesn't implement `CSSStyleSheet.replaceSync`, so the constructor
// throws and pollutes the test run with an unhandled error even though our
// assertions only care about the Approve / Reject buttons. Stub the diff
// renderer here so this unit test stays focused on button wiring; Pierre's
// real rendering is exercised in the running app, not in jsdom.
vi.mock("@pierre/diffs/react", () => ({
    FileDiff: () => null,
    useWorkerPool: () => undefined,
}));

describe("DiffView", () => {
    it("fires onApprove/onReject", () => {
        const onApprove = vi.fn();
        const onReject = vi.fn();
        render(
            <DiffView
                file="a.js"
                oldCode="old"
                newCode="new"
                onApprove={onApprove}
                onReject={onReject}
            />
        );
        fireEvent.click(screen.getByText(/approve/i));
        expect(onApprove).toHaveBeenCalled();
        fireEvent.click(screen.getByText(/reject/i));
        expect(onReject).toHaveBeenCalled();
    });
});
