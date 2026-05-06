import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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
        expect(screen.getByRole("button", { name: "test/a.spec.js" })).toHaveAttribute(
            "aria-pressed",
            "false",
        );
        expect(screen.getByRole("button", { name: "test/b.spec.js" })).toHaveAttribute(
            "aria-pressed",
            "true",
        );
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

    it("disables the empty-state Open Settings button when settingsDisabled", async () => {
        render(
            <TestTree
                suites={[]}
                selection={null}
                onSelect={() => {}}
                onOpenSettings={() => {}}
                settingsDisabled
            />
        );
        // ef-button (a Lit element) reflects the disabled prop to the
        // attribute on its next update tick, so the matcher needs an
        // async waitFor — toBeDisabled() reads the attribute, not the
        // property.
        await waitFor(() =>
            expect(screen.getByRole("button", { name: /open settings/i })).toBeDisabled(),
        );
    });

    // ---------- presentation: caseId chip + tag stripping ----------

    const richTree: SuiteTree = {
        file: "/x/regression.spec.ts",
        relPath: "test/regression.spec.ts",
        source: "",
        children: [
            {
                kind: "describe",
                title: "Example Regression Test",
                fullTitle: "Example Regression Test",
                line: 1,
                endLine: 50,
                children: [
                    {
                        kind: "it",
                        title: "C1111111 - Company Overview - Business Summary [Regression][Smoke][Cl_Regression][Cl_Smoke]",
                        fullTitle:
                            "Example Regression Test C1111111 - Company Overview - Business Summary [Regression][Smoke][Cl_Regression][Cl_Smoke]",
                        line: 5,
                        endLine: 10,
                        children: [],
                    },
                    {
                        kind: "it",
                        title: "C2222222 - OwnerShip [Regression][Smoke]",
                        fullTitle:
                            "Example Regression Test C2222222 - OwnerShip [Regression][Smoke]",
                        line: 12,
                        endLine: 18,
                        children: [],
                    },
                    {
                        kind: "it",
                        title: "Move to ProductAlarm",
                        fullTitle: "Example Regression Test Move to ProductAlarm",
                        line: 20,
                        endLine: 22,
                        children: [],
                    },
                ],
            },
        ],
    };
    const richSuite = [{ relPath: "test/regression.spec.ts", absPath: "/x/regression.spec.ts" }];

    it("renders caseId chips and strips bracketed tags from visible text", async () => {
        render(
            <TestTree
                suites={richSuite}
                selection={null}
                onSelect={() => {}}
                fetchTree={async () => richTree}
            />
        );
        fireEvent.click(screen.getByLabelText("expand test/regression.spec.ts"));
        await waitFor(() => rowByText(/Company Overview - Business Summary/));

        // caseId surfaced as its own chip span — separated from the rest of
        // the title so the QA's eye finds the identifier without scanning.
        expect(screen.getByText("C1111111")).toHaveClass("suite-caseid-chip");
        expect(screen.getByText("C2222222")).toHaveClass("suite-caseid-chip");

        // Bracketed tags must NOT appear as visible text — they're noise
        // when every row in the file repeats the same tag set.
        const row = rowByText(/Company Overview - Business Summary/);
        expect(row.textContent).not.toMatch(/\[Regression\]/);
        expect(row.textContent).not.toMatch(/\[Smoke\]/);
        expect(row.textContent).not.toMatch(/\[Cl_/);

        // The displayed chip-count surfaces the tag count (+4) for that row,
        // and the full tag list lives on the chip's `title` attribute so
        // hovering reveals it.
        const chipCounts = screen.getAllByText(/^\+\d+$/);
        const fourChip = chipCounts.find((el) => el.textContent === "+4");
        expect(fourChip).toBeTruthy();
        expect(fourChip).toHaveAttribute("title", "Regression · Smoke · Cl_Regression · Cl_Smoke");

        // Row without tags has no count chip.
        const plainRow = rowByText(/Move to ProductAlarm/);
        expect(plainRow.textContent).not.toMatch(/\+\d+/);
    });

    it("preserves the raw title (with tags) on the row's hover tooltip", async () => {
        render(
            <TestTree
                suites={richSuite}
                selection={null}
                onSelect={() => {}}
                fetchTree={async () => richTree}
            />
        );
        fireEvent.click(screen.getByLabelText("expand test/regression.spec.ts"));
        await waitFor(() => rowByText(/Company Overview - Business Summary/));
        const row = rowByText(/Company Overview - Business Summary/);
        expect(row).toHaveAttribute(
            "title",
            "C1111111 - Company Overview - Business Summary [Regression][Smoke][Cl_Regression][Cl_Smoke]",
        );
    });

    it("clicking a chipped it row still selects by raw fullTitle (preserves --grep semantics)", async () => {
        const onSelect = vi.fn();
        render(
            <TestTree
                suites={richSuite}
                selection={null}
                onSelect={onSelect}
                fetchTree={async () => richTree}
            />
        );
        fireEvent.click(screen.getByLabelText("expand test/regression.spec.ts"));
        await waitFor(() => rowByText(/Company Overview - Business Summary/));
        fireEvent.click(rowByText(/Company Overview - Business Summary/));
        expect(onSelect).toHaveBeenCalledWith({
            spec: "test/regression.spec.ts",
            node: {
                kind: "it",
                fullTitle:
                    "Example Regression Test C1111111 - Company Overview - Business Summary [Regression][Smoke][Cl_Regression][Cl_Smoke]",
            },
        });
    });

    // ---------- search / filter ----------

    function getSearchInput(): HTMLInputElement {
        // ef-text-field renders a real <input> in shadow DOM, but in
        // jsdom the @lit/react wrapper bubbles `value-changed` events
        // when we set the property. Easier: dispatch a synthetic event.
        return screen.getByLabelText("filter test suites") as unknown as HTMLInputElement;
    }
    function setQuery(v: string) {
        const field = getSearchInput();
        // ef-text-field fires a CustomEvent<{value}> on edit. Simulate it
        // directly so the React handler runs without needing shadow-DOM
        // typing to drill into the inner <input>. Wrap in act() so the
        // resulting state update + debounced effect schedule are flushed
        // inside the test's act-tracked window.
        act(() => {
            field.dispatchEvent(
                new CustomEvent("value-changed", { detail: { value: v }, bubbles: true }),
            );
        });
    }

    const multiSuiteList = [
        { relPath: "test/regressionTest.ts", absPath: "/x/regressionTest.ts" },
        { relPath: "test/productAlarm.ts", absPath: "/x/productAlarm.ts" },
    ];
    const productAlarmTree: SuiteTree = {
        file: "/x/productAlarm.ts",
        relPath: "test/productAlarm.ts",
        source: "",
        children: [
            {
                kind: "describe",
                title: "Product Alarm",
                fullTitle: "Product Alarm",
                line: 1,
                endLine: 10,
                children: [
                    {
                        kind: "it",
                        title: "C9999999 - Trigger alarm [Smoke]",
                        fullTitle: "Product Alarm C9999999 - Trigger alarm [Smoke]",
                        line: 2,
                        endLine: 5,
                        children: [],
                    },
                ],
            },
        ],
    };

    it("typing in the filter narrows the visible files and tests", async () => {
        const fetchTree = vi.fn(async (spec: string) => {
            if (spec === "test/regressionTest.ts") return richTree;
            if (spec === "test/productAlarm.ts") return productAlarmTree;
            throw new Error("unknown spec");
        });
        render(
            <TestTree
                suites={multiSuiteList}
                selection={null}
                onSelect={() => {}}
                fetchTree={fetchTree}
            />
        );

        // Trigger filter — the tree auto-loads every suite (debounced 250ms)
        // so a hidden tag like [Smoke] can be matched in unopened files.
        // Use "Trigger" (only in productAlarm) so the assertion that the
        // other file is hidden isn't muddied by accidental substring hits.
        setQuery("Trigger");
        await waitFor(
            () => expect(fetchTree).toHaveBeenCalledWith("test/productAlarm.ts"),
            { timeout: 1500 },
        );
        await waitFor(() => rowByText(/Trigger alarm/));

        // The non-matching file row (regressionTest.ts) is hidden.
        expect(screen.queryByRole("button", { name: "test/regressionTest.ts" })).toBeNull();
        // The matching file row is shown and auto-expanded so the leaf
        // is visible without a manual click.
        expect(screen.getByRole("button", { name: "test/productAlarm.ts" })).toBeInTheDocument();
        expect(rowByText(/Trigger alarm/)).toBeInTheDocument();

        // The tests-match meta-line summarizes the result count.
        expect(screen.getByText(/\d+ of \d+ tests match/i)).toBeInTheDocument();
    });

    it("matches against tags even though they are visually hidden", async () => {
        const fetchTree = vi.fn(async (spec: string) => {
            if (spec === "test/regressionTest.ts") return richTree;
            if (spec === "test/productAlarm.ts") return productAlarmTree;
            throw new Error("unknown spec");
        });
        render(
            <TestTree
                suites={multiSuiteList}
                selection={null}
                onSelect={() => {}}
                fetchTree={fetchTree}
            />
        );

        setQuery("Cl_Regression");
        await waitFor(
            () => expect(fetchTree).toHaveBeenCalledWith("test/regressionTest.ts"),
            { timeout: 1500 },
        );
        await waitFor(() => rowByText(/Company Overview - Business Summary/));

        // Only the row that carries [Cl_Regression] is visible. The other
        // it() in the same describe (OwnerShip — no Cl_Regression tag) is
        // hidden, even though its parent describe matches as a container.
        expect(rowByText(/Company Overview - Business Summary/)).toBeInTheDocument();
        // OwnerShip row has [Regression][Smoke] but NOT [Cl_Regression] —
        // should be filtered out. (rowByText throws if not exactly 1 match,
        // so use queryAllByRole instead.)
        const allRows = screen
            .queryAllByRole("button")
            .filter((el) => el.classList.contains("suite-row"));
        const ownership = allRows.find((el) => /OwnerShip/.test(el.textContent ?? ""));
        expect(ownership).toBeUndefined();

        // The unrelated file (productAlarm) has no tag matching, so its
        // row is hidden too.
        expect(screen.queryByRole("button", { name: "test/productAlarm.ts" })).toBeNull();
    });

    it("clear button resets the filter", async () => {
        const fetchTree = vi.fn(async (spec: string) => {
            if (spec === "test/regressionTest.ts") return richTree;
            if (spec === "test/productAlarm.ts") return productAlarmTree;
            throw new Error("unknown spec");
        });
        render(
            <TestTree
                suites={multiSuiteList}
                selection={null}
                onSelect={() => {}}
                fetchTree={fetchTree}
            />
        );

        setQuery("Trigger");
        await waitFor(() => expect(screen.queryByRole("button", { name: "test/regressionTest.ts" })).toBeNull());

        fireEvent.click(screen.getByLabelText("clear filter"));
        // After clearing, both file rows are visible again.
        expect(screen.getByRole("button", { name: "test/regressionTest.ts" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "test/productAlarm.ts" })).toBeInTheDocument();
        // The tests-match meta-line is gone when not filtering.
        expect(screen.queryByText(/of \d+ tests match/i)).toBeNull();
    });

    it("filter matches a file by path even when no tests inside match", async () => {
        const fetchTree = vi.fn(async (spec: string) => {
            if (spec === "test/regressionTest.ts") return richTree;
            if (spec === "test/productAlarm.ts") return productAlarmTree;
            throw new Error("unknown spec");
        });
        render(
            <TestTree
                suites={multiSuiteList}
                selection={null}
                onSelect={() => {}}
                fetchTree={fetchTree}
            />
        );
        // "regressionTest" appears in the path but not in any test title.
        setQuery("regressionTest");
        await waitFor(() =>
            expect(screen.getByRole("button", { name: "test/regressionTest.ts" })).toBeInTheDocument(),
        );
        // The unrelated file is hidden.
        expect(screen.queryByRole("button", { name: "test/productAlarm.ts" })).toBeNull();
    });
});
