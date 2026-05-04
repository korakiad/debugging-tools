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
    });
}

describe("LogPanel", () => {
    beforeEach(resetStore);

    it("renders the empty placeholder when there are no log lines", () => {
        render(<LogPanel />);
        expect(
            screen.getByText(/Run a test to see the live log here/i)
        ).toBeInTheDocument();
    });

    it("shows the IDLE status pill when no run has started", () => {
        render(<LogPanel />);
        expect(screen.getByText("IDLE")).toBeInTheDocument();
    });

    it("renders a row per mocha log line with the correct level badge", () => {
        useStore.setState({
            mochaLog: [
                { stream: "stdout", text: "  ✓ pass case", receivedAt: 0 },
                { stream: "stderr", text: "ChromeDriver detached", receivedAt: 1 },
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

    it("renders a SELF-HEAL block when a diff is pending", () => {
        useStore.setState({
            pendingDiff: {
                reqId: "r1",
                file: "pages/login.page.js",
                oldCode: "button.submit-btn",
                newCode: "button[data-testid=\"login-submit\"]",
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
