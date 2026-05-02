import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TestTree, type SuiteTree } from "./TestTree";

const oneSuite = [{ relPath: "test/a.spec.js", absPath: "/x/a.spec.js" }];

const sampleTree: SuiteTree = {
    file: "/x/a.spec.js",
    relPath: "test/a.spec.js",
    source: "describe('SauceDemo Login', () => {\n  it('should enter username', () => {});\n  it('should enter password', () => {});\n});\n",
    children: [
        {
            kind: "describe",
            title: "SauceDemo Login",
            fullTitle: "SauceDemo Login",
            line: 1,
            endLine: 4,
            children: [
                { kind: "it", title: "should enter username", fullTitle: "SauceDemo Login should enter username", line: 2, endLine: 2, children: [] },
                { kind: "it", title: "should enter password", fullTitle: "SauceDemo Login should enter password", line: 3, endLine: 3, children: [] },
            ],
        },
    ],
};

describe("TestTree", () => {
    it("renders suites and selects the whole file when the file row is clicked", () => {
        const onSelect = vi.fn();
        render(
            <TestTree
                suites={oneSuite}
                selection={null}
                onSelect={onSelect}
                fetchTree={async () => sampleTree}
            />
        );
        fireEvent.click(screen.getByText("test/a.spec.js"));
        expect(onSelect).toHaveBeenCalledWith({ spec: "test/a.spec.js", node: null });
    });

    it("marks the file row aria-pressed when its whole-file selection is active", () => {
        render(
            <TestTree
                suites={[
                    { relPath: "test/a.spec.js", absPath: "/x/a.spec.js" },
                    { relPath: "test/b.spec.js", absPath: "/x/b.spec.js" },
                ]}
                selection={{ spec: "test/b.spec.js", node: null }}
                onSelect={() => {}}
            />
        );
        expect(screen.getByText("test/a.spec.js")).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByText("test/b.spec.js")).toHaveAttribute("aria-pressed", "true");
    });

    // The suite-row buttons share their accessible name with the caret button
    // (aria-label "collapse <title>"). Filter by the suite-row class so tests
    // pick the row button, not the caret.
    function rowByText(needle: RegExp): HTMLElement {
        const matches = screen.getAllByRole("button").filter(
            (el) => el.classList.contains("suite-row") && needle.test(el.textContent ?? "")
        );
        if (matches.length !== 1) throw new Error(`expected 1 row matching ${needle}, got ${matches.length}`);
        return matches[0];
    }

    it("expanding a file fetches the tree and renders describe/it rows", async () => {
        const fetchTree = vi.fn().mockResolvedValue(sampleTree);
        render(
            <TestTree
                suites={oneSuite}
                selection={null}
                onSelect={() => {}}
                fetchTree={fetchTree}
            />
        );
        fireEvent.click(screen.getByLabelText("expand test/a.spec.js"));
        await waitFor(() => expect(fetchTree).toHaveBeenCalledWith("test/a.spec.js"));
        // Wait until the parsed children are mounted, then assert the rows.
        await waitFor(() => rowByText(/^SauceDemo Login$/));
        rowByText(/should enter username/);
        rowByText(/should enter password/);
    });

    it("clicking an it row selects that test with its fullTitle", async () => {
        const onSelect = vi.fn();
        render(
            <TestTree
                suites={oneSuite}
                selection={null}
                onSelect={onSelect}
                fetchTree={async () => sampleTree}
            />
        );
        fireEvent.click(screen.getByLabelText("expand test/a.spec.js"));
        await waitFor(() => rowByText(/should enter username/));
        fireEvent.click(rowByText(/should enter username/));
        expect(onSelect).toHaveBeenCalledWith({
            spec: "test/a.spec.js",
            node: { kind: "it", fullTitle: "SauceDemo Login should enter username" },
        });
    });

    it("clicking a describe row selects the describe with its fullTitle", async () => {
        const onSelect = vi.fn();
        render(
            <TestTree
                suites={oneSuite}
                selection={null}
                onSelect={onSelect}
                fetchTree={async () => sampleTree}
            />
        );
        fireEvent.click(screen.getByLabelText("expand test/a.spec.js"));
        await waitFor(() => rowByText(/^SauceDemo Login$/));
        fireEvent.click(rowByText(/^SauceDemo Login$/));
        expect(onSelect).toHaveBeenCalledWith({
            spec: "test/a.spec.js",
            node: { kind: "describe", fullTitle: "SauceDemo Login" },
        });
    });

    it("dynamic-title nodes fall back to whole-file selection (can't grep dynamic titles)", async () => {
        const onSelect = vi.fn();
        const dynTree: SuiteTree = {
            file: "/x/a.spec.js",
            relPath: "test/a.spec.js",
            source: "",
            children: [
                { kind: "describe", title: "<dynamic>", fullTitle: "<dynamic>", line: 1, endLine: 1, children: [] },
            ],
        };
        render(
            <TestTree
                suites={oneSuite}
                selection={null}
                onSelect={onSelect}
                fetchTree={async () => dynTree}
            />
        );
        fireEvent.click(screen.getByLabelText("expand test/a.spec.js"));
        await waitFor(() => rowByText(/<dynamic>/));
        fireEvent.click(rowByText(/<dynamic>/));
        expect(onSelect).toHaveBeenCalledWith({ spec: "test/a.spec.js", node: null });
    });

    it("shows a fetch error when the tree endpoint fails", async () => {
        render(
            <TestTree
                suites={oneSuite}
                selection={null}
                onSelect={() => {}}
                fetchTree={async () => {
                    throw new Error("HTTP 500");
                }}
            />
        );
        fireEvent.click(screen.getByLabelText("expand test/a.spec.js"));
        expect(await screen.findByText(/failed to parse: http 500/i)).toBeInTheDocument();
    });

    it("renders an empty-state nudge when there are no suites", () => {
        render(
            <TestTree
                suites={[]}
                selection={null}
                onSelect={() => {}}
                onOpenSettings={() => {}}
            />
        );
        expect(screen.getByText(/no test files yet/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /open settings/i })).toBeInTheDocument();
    });

    it("clicking the empty-state Open Settings button calls onOpenSettings", () => {
        const onOpenSettings = vi.fn();
        render(
            <TestTree
                suites={[]}
                selection={null}
                onSelect={() => {}}
                onOpenSettings={onOpenSettings}
            />
        );
        fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it("when disabled, file row clicks are no-ops and rows are aria-disabled", async () => {
        const onSelect = vi.fn();
        render(
            <TestTree
                suites={oneSuite}
                selection={null}
                onSelect={onSelect}
                fetchTree={async () => sampleTree}
                disabled
            />
        );
        const fileRow = screen.getByRole("button", { name: "test/a.spec.js" });
        expect(fileRow).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(fileRow);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("when disabled, describe/it row clicks are no-ops and rows are aria-disabled", async () => {
        const onSelect = vi.fn();
        render(
            <TestTree
                suites={oneSuite}
                selection={null}
                onSelect={onSelect}
                fetchTree={async () => sampleTree}
                disabled
            />
        );
        fireEvent.click(screen.getByLabelText("expand test/a.spec.js"));
        await waitFor(() => rowByText(/should enter username/));
        const itRow = rowByText(/should enter username/);
        expect(itRow).toHaveAttribute("aria-disabled", "true");
        fireEvent.click(itRow);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("disables the empty-state Open Settings button when settingsDisabled", () => {
        render(
            <TestTree
                suites={[]}
                selection={null}
                onSelect={() => {}}
                onOpenSettings={() => {}}
                settingsDisabled
            />
        );
        expect(screen.getByRole("button", { name: /open settings/i })).toBeDisabled();
    });
});
