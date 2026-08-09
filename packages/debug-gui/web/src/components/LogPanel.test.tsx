import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LogPanel } from "./LogPanel";
import { useStore } from "../state/store";

function resetStore() {
    useStore.setState({
        suites: [],
        config: {},
        state: { state: "idle" },
        selectedSpec: null,
        selectedNode: null,
        suiteTrees: {},
        chatMessages: [],
        pendingDiff: null,
        pendingPick: null,
        pendingPrompt: null,
        mochaLog: [],
        mochaExitCode: undefined,
        runStartedAt: null,
        agentThinking: false,
        agentActivity: "",
        notice: null,
    });
}

describe("LogPanel", () => {
    beforeEach(resetStore);

    it("renders the 'Ready to run' hero before the first run has started", () => {
        render(<LogPanel />);
        // Pre-run empty state. LogPanel keys this off runStartedAt == null,
        // so it surfaces whether or not a spec is selected.
        expect(screen.getByRole("heading", { name: /ready to run/i })).toBeInTheDocument();
        expect(screen.getByText(/press start in the toolbar above/i)).toBeInTheDocument();
    });

    it("falls back to the generic empty placeholder mid-run with no output yet", () => {
        // runStartedAt is set (a run has begun) but no mocha lines have
        // arrived yet — short-lived but real. The hero copy isn't right
        // here, so LogTable falls back to its built-in default text.
        useStore.setState({ runStartedAt: 1, state: { state: "running" } });
        render(<LogPanel />);
        expect(
            screen.getByText(/Run a test to see the live log here/i)
        ).toBeInTheDocument();
    });

    it("shows the IDLE state in the status bar heading when no run has started", () => {
        render(<LogPanel />);
        // ef-appstate-bar's `heading` is a non-reflected property and the
        // text renders inside shadow DOM (part=heading), so getByText
        // can't reach it and getAttribute is null. Assert on the JS
        // property + the data-session attribute that styles the ribbon.
        const bar = document.querySelector("ef-appstate-bar.log-status") as
            | (HTMLElement & { heading?: string })
            | null;
        expect(bar).not.toBeNull();
        expect(bar?.heading).toBe("IDLE");
        expect(bar?.getAttribute("data-session")).toBe("idle");
    });

    it("renders a row per mocha log line with the correct level badge", () => {
        useStore.setState({
            mochaLog: [
                { stream: "stdout", text: "  ✓ pass case", receivedAt: 0, seq: 1 },
                { stream: "stderr", text: "ChromeDriver detached", receivedAt: 1, seq: 2 },
            ],
            runStartedAt: 0,
        });
        render(<LogPanel />);
        expect(screen.getByText("PASS")).toBeInTheDocument();
        expect(screen.getByText("WARN")).toBeInTheDocument();
        expect(screen.getByText(/pass case/)).toBeInTheDocument();
    });

    it("surfaces selectedSpec in the breadcrumb", () => {
        useStore.setState({
            selectedSpec: "test/login.spec.js",
            selectedNode: null,
        });
        render(<LogPanel />);
        expect(screen.getByText("test/login.spec.js")).toBeInTheDocument();
    });

    it("breadcrumb shows parent describe and leaf title from suiteTrees", () => {
        // Reproduces the regression where the prior `\\s>\\s|\\s` regex
        // split every space, producing suite="Login Form should click the
        // submit" / test="button". The fix walks suiteTrees to recover
        // the real parent describe + leaf title.
        useStore.setState({
            selectedSpec: "test/login.spec.js",
            selectedNode: {
                kind: "it",
                fullTitle: "Login Form should click the submit button",
            },
            suiteTrees: {
                "test/login.spec.js": {
                    file: "/x/login.spec.js",
                    relPath: "test/login.spec.js",
                    children: [
                        {
                            kind: "describe",
                            title: "Login Form",
                            fullTitle: "Login Form",
                            line: 1,
                            endLine: 30,
                            children: [
                                {
                                    kind: "it",
                                    title: "should click the submit button",
                                    fullTitle: "Login Form should click the submit button",
                                    line: 10,
                                    endLine: 15,
                                    children: [],
                                },
                            ],
                        },
                    ],
                },
            },
        });
        render(<LogPanel />);
        expect(screen.getByText("Login Form")).toBeInTheDocument();
        expect(screen.getByText("should click the submit button")).toBeInTheDocument();
    });

    it("STEP shows passed-of-planned, not passed-of-passed", () => {
        // Regression for I2: total used to be `passed + failed`, so the
        // counter showed `n/n` perpetually. Now it's the planned-test
        // count from the parsed suite tree under the selection.
        useStore.setState({
            selectedSpec: "test/login.spec.js",
            selectedNode: null, // whole spec → 3 planned tests
            suiteTrees: {
                "test/login.spec.js": {
                    file: "/x/login.spec.js",
                    relPath: "test/login.spec.js",
                    children: [
                        {
                            kind: "describe",
                            title: "Login",
                            fullTitle: "Login",
                            line: 1,
                            endLine: 30,
                            children: [
                                { kind: "it", title: "a", fullTitle: "Login a", line: 5, endLine: 6, children: [] },
                                { kind: "it", title: "b", fullTitle: "Login b", line: 7, endLine: 8, children: [] },
                                { kind: "it", title: "c", fullTitle: "Login c", line: 9, endLine: 10, children: [] },
                            ],
                        },
                    ],
                },
            },
            mochaLog: [
                { stream: "stdout", text: "  ✓ a", receivedAt: 0, seq: 1 },
            ],
            runStartedAt: 0,
            state: { state: "running" },
        });
        render(<LogPanel />);
        // 1 passing in mocha output, 3 planned in the tree.
        // Breadcrumb's StepDots advertises "step 1 of 3" via aria-label.
        expect(screen.getByLabelText("step 1 of 3")).toBeInTheDocument();
        // And renders 3 dots, only 1 filled.
        const dots = document.querySelectorAll(".log-breadcrumb-dot");
        expect(dots).toHaveLength(3);
        expect(document.querySelectorAll(".log-breadcrumb-dot[data-filled]")).toHaveLength(1);
    });

    it("freezes the elapsed timer while state is paused", () => {
        vi.useFakeTimers();
        try {
            const T0 = 1_700_000_000_000;
            vi.setSystemTime(T0);
            useStore.setState({
                state: { state: "running" },
                runStartedAt: T0 - 5_000, // 5s into the run
            });
            const { rerender } = render(<LogPanel />);
            expect(screen.getByText(/^00:05\./)).toBeInTheDocument();

            act(() => {
                useStore.setState({ state: { state: "paused" } });
            });
            rerender(<LogPanel />);

            // 10s of wall-clock pass while paused — elapsed must NOT grow.
            act(() => {
                vi.advanceTimersByTime(10_000);
            });
            rerender(<LogPanel />);

            expect(screen.getByText(/^00:05\./)).toBeInTheDocument();
            expect(screen.queryByText(/^00:15\./)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("renders an info notice between StatusHeader and the breadcrumb", () => {
        // After an approved edit during pause the server broadcasts a
        // `notice`. LogPanel surfaces it via ef-notification so QA can't
        // miss the "click Run, not Continue" guidance.
        useStore.setState({
            notice: {
                kind: "info",
                message: "Fix saved to disk. Click Run to re-execute the suite.",
            },
        });
        render(<LogPanel />);
        const el = document.querySelector("ef-notification.log-notice") as
            | (HTMLElement & { message?: string })
            | null;
        expect(el).not.toBeNull();
        // ef-notification stores the message as a JS property (rendered into
        // shadow DOM), same pattern as StatusHeader's heading assertion.
        expect(el?.message).toMatch(/click run/i);
        expect(el?.getAttribute("data-kind")).toBe("info");
    });

    it("renders a SELF-HEAL block when a diff is pending", () => {
        useStore.setState({
            pendingDiff: {
                reqId: "r1",
                file: "pages/login.page.js",
                oldCode: "button.submit-btn",
                newCode: "button[data-testid=\"login-submit\"]",
                receivedAt: 0,
            },
        });
        render(<LogPanel />);
        // The SELF-HEAL appears both as a row level and as the badge in the
        // SelfHealBlock header — getAllByText handles both.
        const matches = screen.getAllByText("SELF-HEAL");
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/button\.submit-btn/)).toBeInTheDocument();
    });

});
