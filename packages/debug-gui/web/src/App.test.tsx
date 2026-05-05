import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Stub the websocket hook so App doesn't try to open a real connection.
// Use vi.hoisted so sendSpy is available to the hoisted vi.mock factory.
const { sendSpy } = vi.hoisted(() => ({ sendSpy: vi.fn() }));
vi.mock("./hooks/useWebSocket", () => ({
    useWebSocket: () => ({ send: sendSpy }),
}));

import App from "./App";
import { useStore } from "./state/store";

describe("App empty-state integration", () => {
    it("opens the SettingsDialog when the TestTree empty-state Open Settings button is clicked", () => {
        render(<App />);
        // Pre-click: the modal dialog is not in the DOM.
        expect(screen.queryByRole("dialog", { name: /settings/i })).not.toBeInTheDocument();

        // Click the empty-state nudge button (text "Open Settings ⚙").
        fireEvent.click(screen.getByRole("button", { name: /open settings/i }));

        // Post-click: the modal dialog is mounted.
        expect(screen.getByRole("dialog", { name: /settings/i })).toBeInTheDocument();
    });
});

describe("App suite-switch confirmation", () => {
    beforeEach(() => {
        sendSpy.mockReset();
        // Reset store to a known idle state with two discoverable suites.
        useStore.setState({
            suites: [
                { relPath: "test/a.spec.js", absPath: "/x/a.spec.js" },
                { relPath: "test/b.spec.js", absPath: "/x/b.spec.js" },
            ],
            selectedSpec: "test/a.spec.js",
            selectedNode: null,
            state: { state: "idle" },
            suiteTrees: {},
            config: {},
        });
    });

    it("idle: clicking another suite applies immediately, no dialog", () => {
        render(<App />);
        // Sanity: dialog not present.
        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("test/b.spec.js"));

        expect(useStore.getState().selectedSpec).toBe("test/b.spec.js");
        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
    });

    it("running: clicking another suite opens confirm dialog and does NOT change selection", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));

        // Dialog mounted.
        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        // Selection not changed yet.
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
    });

    it("running: clicking the current selection is a no-op (no dialog)", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        // Role-based query disambiguates the sidebar button from the selection echo in the main pane.
        fireEvent.click(screen.getByRole("button", { name: "test/a.spec.js" }));

        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
    });

    it("running: clicking 'Keep running' closes dialog, does NOT send cancel, leaves selection", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));
        fireEvent.click(screen.getByRole("button", { name: /keep running/i }));

        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
        expect(sendSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: "cancel" }));
    });

    it("running: clicking 'Switch' sends cancel, shows 'Stopping…', does NOT yet swap selection", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));
        fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

        expect(sendSpy).toHaveBeenCalledWith({ type: "cancel" });
        // Dialog still open, but in switching phase.
        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        expect(screen.getByText(/stopping current run/i)).toBeInTheDocument();
        // Buttons gone.
        expect(screen.queryByRole("button", { name: /^switch$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /keep running/i })).not.toBeInTheDocument();
        // Selection unchanged.
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
    });

    it("paused: clicking another suite opens confirm dialog", () => {
        useStore.setState({ state: { state: "paused" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));

        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
    });

    it("running: SelectionPanel clear button while node is selected opens confirm dialog", () => {
        useStore.setState({
            state: { state: "running" },
            selectedSpec: "test/a.spec.js",
            selectedNode: { kind: "it", fullTitle: "Login should pass" },
        });
        render(<App />);

        fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));

        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        expect(useStore.getState().selectedNode).toEqual({ kind: "it", fullTitle: "Login should pass" });
    });

    it("after Switch: when status flips to idle, pendingSelection is applied and dialog closes", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));
        fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

        // Simulate the server broadcasting status:idle (cancel landed).
        act(() => {
            useStore.getState().applyEvent({ type: "status", state: "idle" });
        });

        expect(useStore.getState().selectedSpec).toBe("test/b.spec.js");
        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
    });

    it("paused → Switch to a different node within the same spec → idle: failure clears and selection swaps", () => {
        // Reproduces a user-reported scenario: state is paused on test A;
        // user changes selection inside the same .spec.js (here we use the
        // SelectionPanel's clear button — `it → null` — to drive the same
        // `requestSelectionChange` code path that an in-tree `it → it`
        // click goes through). The failure and paused status must clear
        // once the cancel lands.
        useStore.setState({
            suites: [
                { relPath: "test/a.spec.js", absPath: "/x/a.spec.js" },
            ],
            selectedSpec: "test/a.spec.js",
            selectedNode: { kind: "it", fullTitle: "Login Form should click the submit button" },
            state: {
                state: "paused",
                currentFailure: {
                    test: "should click the submit button",
                    file: "test/a.spec.js",
                    error: "Element not found",
                    stack: "",
                },
            },
            mochaLog: [{ stream: "stdout", text: "old line", receivedAt: 0, seq: 1 }],
        });
        render(<App />);

        // Pre-flight sanity: paused UI is showing with the failure rendered.
        expect(screen.getByText("Status: paused")).toBeInTheDocument();
        // "Element not found" appears in BOTH the FailureCard and the
        // LogPanel's synthetic FAIL row derived from currentFailure, so
        // count rather than uniqueness-assert.
        expect(screen.getAllByText(/Element not found/i).length).toBeGreaterThan(0);

        // SelectionPanel's clear button drives requestSelectionChange with
        // `node: null` — a node CHANGE within the same spec, exactly the
        // same App.tsx branch as an `it → it` tree click would take.
        fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));
        // The Switch suite dialog must open since we're paused.
        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

        // Server side responds: runner killed → session.reset() → status:idle.
        act(() => {
            useStore.getState().applyEvent({ type: "status", state: "idle" });
        });

        // Selection swapped: same spec, node now null (whole-file).
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
        expect(useStore.getState().selectedNode).toBeNull();
        // Snapshot is fully reset — no lingering paused or currentFailure.
        expect(useStore.getState().state).toEqual({ state: "idle" });
        // FailureCard + synthetic LogPanel FAIL row both unmounted.
        expect(screen.queryAllByText(/Element not found/i)).toHaveLength(0);
        // Continue button gone.
        expect(screen.queryByRole("button", { name: /^continue$/i })).not.toBeInTheDocument();
        // Status pill flipped.
        expect(screen.getByText("Status: idle")).toBeInTheDocument();
    });

    it("paused → Switch within the same spec → idle: chat messages and pending prompt are cleared", () => {
        // QA-reported bug: after a paused run the agent's mid-conversation
        // chat (chat_final body + ask_user prompt with Apply fix /
        // Inspect / Skip choices) was sticking around when QA clicked a
        // sibling row in the sidebar. Drives the SAME-spec switch path
        // (SelectionPanel clear button → node: null) so we exercise the
        // bug-relevant branch of selectSuite, not the spec-changed
        // branch which already cleared correctly.
        useStore.setState({
            suites: [{ relPath: "test/a.spec.js", absPath: "/x/a.spec.js" }],
            selectedSpec: "test/a.spec.js",
            selectedNode: { kind: "it", fullTitle: "Login Form should click the submit button" },
            state: {
                state: "paused",
                currentFailure: { test: "x", file: "y", error: "boom", stack: "" },
            },
            chatMessages: [{ role: "assistant", content: "Stale selector — propose updating it to 'button[type=\"submit\"]'." }],
            pendingPrompt: {
                reqId: "r1",
                summary: "MockPage.submitButton returns stale selector",
                options: [
                    { id: "apply_a", label: "Fix: update submitButton" },
                    { id: "investigate_b", label: "Inspect the app further" },
                ],
                allowFreeText: true,
            },
            agentThinking: false,
            agentActivity: "",
        });
        render(<App />);

        // Sanity: chat content from the prior paused run is visible.
        expect(screen.getByText(/MockPage.submitButton returns stale selector/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Fix: update submitButton/i })).toBeInTheDocument();

        // Same-spec node change via the SelectionPanel clear button.
        fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));
        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));
        act(() => {
            useStore.getState().applyEvent({ type: "status", state: "idle" });
        });

        // Store state cleared.
        expect(useStore.getState().chatMessages).toEqual([]);
        expect(useStore.getState().pendingPrompt).toBeNull();
        // Selection: same spec, node now null.
        expect(useStore.getState().selectedSpec).toBe("test/a.spec.js");
        expect(useStore.getState().selectedNode).toBeNull();
        // UI no longer renders the stale prompt summary or option button.
        expect(screen.queryByText(/MockPage.submitButton returns stale selector/i)).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Fix: update submitButton/i })).not.toBeInTheDocument();
    });

    it("paused → Switch → idle: snapshot is forced to clean idle (no lingering Continue / FailureCard)", () => {
        useStore.setState({
            state: {
                state: "paused",
                currentFailure: { test: "x", file: "y", error: "boom", stack: "" },
            },
            mochaLog: [{ stream: "stdout", text: "old line", receivedAt: 0, seq: 1 }],
        });
        render(<App />);

        // Sanity: paused-state UI is showing.
        expect(screen.getByText("Status: paused")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^continue$/i })).toBeInTheDocument();

        fireEvent.click(screen.getByText("test/b.spec.js"));
        fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));

        // The cancel landed: server broadcasts status:idle (the gate
        // condition for the apply useEffect).
        act(() => {
            useStore.getState().applyEvent({ type: "status", state: "idle" });
        });

        // Selection swapped.
        expect(useStore.getState().selectedSpec).toBe("test/b.spec.js");
        // Snapshot is fully reset — no leftover paused state.
        expect(useStore.getState().state).toEqual({ state: "idle" });
        // Stale run-output dropped.
        expect(useStore.getState().mochaLog).toEqual([]);
        // UI no longer shows the paused-state controls.
        expect(screen.queryByRole("button", { name: /^continue$/i })).not.toBeInTheDocument();
        expect(screen.queryByText("Status: paused")).not.toBeInTheDocument();
    });

    it("dialog auto-dismisses and selection applies when run finishes naturally", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);
        fireEvent.click(screen.getByText("test/b.spec.js"));
        expect(screen.getByRole("dialog", { name: /switch suite/i })).toBeInTheDocument();
        act(() => {
            useStore.getState().applyEvent({ type: "status", state: "done" });
        });
        expect(screen.queryByRole("dialog", { name: /switch suite/i })).not.toBeInTheDocument();
        expect(useStore.getState().selectedSpec).toBe("test/b.spec.js");
    });

    it("during switching: clicking Stop is a no-op (canStop guarded)", () => {
        useStore.setState({ state: { state: "running" } });
        render(<App />);

        fireEvent.click(screen.getByText("test/b.spec.js"));
        fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));
        // First cancel was sent by the Switch click itself.
        expect(sendSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy).toHaveBeenLastCalledWith({ type: "cancel" });

        // Now switching=true. canStop should be false, so the Stop button's
        // onClick guard (`if (canStop) send(...)`) must drop the click.
        // We can't observe ef-button's `disabled` attr in this jsdom + @lit/react
        // (node build) test environment — the wrapper doesn't reflect props
        // onto the lit element here — so we assert behaviour: no extra cancel.
        fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
        expect(sendSpy).toHaveBeenCalledTimes(1);
    });
});
