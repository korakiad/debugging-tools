import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

describe("store", () => {
    beforeEach(() => {
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
            agentThinking: false,
            agentActivity: "",
        });
    });

    it("init event exposes preRun in config", () => {
        useStore.getState().applyEvent({
            type: "init",
            suites: [],
            config: { preRun: "npm run build" },
            state: { state: "idle" },
        });
        expect((useStore.getState().config as any).preRun).toBe("npm run build");
    });

    it("config_updated event replaces config", () => {
        useStore.setState({ config: { preRun: "old" } });
        useStore.getState().applyEvent({
            type: "config_updated",
            config: { preRun: "npm run build" },
        });
        expect((useStore.getState().config as any).preRun).toBe("npm run build");
    });

    it("status pre-running is stored without clobbering currentSpec", () => {
        useStore.setState({ state: { state: "idle", currentSpec: "x.spec.js" } });
        useStore.getState().applyEvent({ type: "status", state: "pre-running" });
        expect(useStore.getState().state.state).toBe("pre-running");
        expect(useStore.getState().state.currentSpec).toBe("x.spec.js");
    });

    it("initializes with idle state", () => {
        const s = useStore.getState();
        expect(s.state.state).toBe("idle");
    });

    it("apply 'init' event populates suites", () => {
        useStore.getState().applyEvent({
            type: "init",
            suites: [{ relPath: "a.spec.js", absPath: "/x/a.spec.js" }],
            config: {} as any,
            state: { state: "idle" },
        });
        expect(useStore.getState().suites[0].relPath).toBe("a.spec.js");
    });

    it("apply 'paused' event sets failure", () => {
        useStore.getState().applyEvent({
            type: "paused",
            failure: { test: "t", file: "a.spec.js", error: "e", stack: "" },
        });
        expect(useStore.getState().state.currentFailure?.test).toBe("t");
    });

    it("suites_updated clears selectedSpec and selectedNode when the spec disappears", () => {
        useStore.setState({
            suites: [{ relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" }],
            selectedSpec: "test/login.spec.js",
            selectedNode: { kind: "it", fullTitle: "Login works" },
        });
        useStore.getState().applyEvent({
            type: "suites_updated",
            suites: [],
        });
        expect(useStore.getState().selectedSpec).toBeNull();
        expect(useStore.getState().selectedNode).toBeNull();
    });

    it("suites_updated preserves selectedNode when the spec is still present", () => {
        useStore.setState({
            suites: [{ relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" }],
            selectedSpec: "test/login.spec.js",
            selectedNode: { kind: "describe", fullTitle: "Login" },
        });
        useStore.getState().applyEvent({
            type: "suites_updated",
            suites: [{ relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" }],
        });
        expect(useStore.getState().selectedNode).toEqual({ kind: "describe", fullTitle: "Login" });
    });

    it("suites_updated preserves selectedSpec when it is still present in the new suites", () => {
        useStore.setState({
            suites: [{ relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" }],
            selectedSpec: "test/login.spec.js",
        });
        useStore.getState().applyEvent({
            type: "suites_updated",
            suites: [
                { relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" },
                { relPath: "test/checkout.spec.js", absPath: "/x/test/checkout.spec.js" },
            ],
        });
        expect(useStore.getState().selectedSpec).toBe("test/login.spec.js");
    });

    it("sets pendingPrompt on prompt event", () => {
        useStore.getState().applyEvent({
            type: "prompt",
            reqId: "r1",
            summary: "Login button not found",
            options: [
                { id: "apply_a", label: "Use [data-test=login]" },
                { id: "investigate_b", label: "Inspect modal first" },
            ],
            allowFreeText: true,
        });
        const p = useStore.getState().pendingPrompt;
        expect(p?.reqId).toBe("r1");
        expect(p?.summary).toBe("Login button not found");
        expect(p?.options).toHaveLength(2);
        expect(p?.allowFreeText).toBe(true);
    });

    it("clears pendingPrompt when explicitly reset (response sent)", () => {
        useStore.setState({
            pendingPrompt: { reqId: "r1", summary: "x", options: [], allowFreeText: false },
        });
        useStore.setState({ pendingPrompt: null });
        expect(useStore.getState().pendingPrompt).toBeNull();
    });

    describe("selectSuite", () => {
        const stale = {
            mochaLog: [{ stream: "stdout" as const, text: "old log\n" }],
            mochaExitCode: 1,
            chatMessages: [{ role: "assistant" as const, content: "old chat" }],
            agentThinking: true,
            agentActivity: "thinking about old spec",
            pendingDiff: { reqId: "d1", file: "old.js", oldCode: "a", newCode: "b" },
            pendingPick: { reqId: "p1", imageUrl: "img", hint: "hint" },
            pendingPrompt: { reqId: "q1", summary: "s", options: [], allowFreeText: false },
            state: {
                state: "done" as const,
                currentSpec: "test/old.spec.js",
                currentFailure: { test: "t", file: "test/old.spec.js", error: "e", stack: "" },
            },
        };

        it("clears stale run-output when switching to a different spec", () => {
            useStore.setState({
                ...stale,
                selectedSpec: "test/old.spec.js",
                selectedNode: { kind: "it", fullTitle: "old > t" },
            });

            useStore.getState().selectSuite("test/new.spec.js", null);

            const s = useStore.getState();
            expect(s.selectedSpec).toBe("test/new.spec.js");
            expect(s.selectedNode).toBeNull();
            expect(s.mochaLog).toEqual([]);
            expect(s.mochaExitCode).toBeUndefined();
            expect(s.chatMessages).toEqual([]);
            expect(s.agentThinking).toBe(false);
            expect(s.agentActivity).toBe("");
            expect(s.pendingDiff).toBeNull();
            expect(s.pendingPick).toBeNull();
            expect(s.pendingPrompt).toBeNull();
            expect(s.state.currentFailure).toBeUndefined();
            expect(s.state.currentSpec).toBeUndefined();
            // Session-state field itself is preserved (idle/done/etc).
            expect(s.state.state).toBe("done");
        });

        it("clears stale state when switching from no-selection to a spec", () => {
            useStore.setState({
                ...stale,
                selectedSpec: null,
                selectedNode: null,
            });

            useStore.getState().selectSuite("test/new.spec.js", null);

            const s = useStore.getState();
            expect(s.selectedSpec).toBe("test/new.spec.js");
            expect(s.mochaLog).toEqual([]);
            expect(s.state.currentFailure).toBeUndefined();
            expect(s.chatMessages).toEqual([]);
        });

        it("clears run-output when the node changes within the same spec", () => {
            // Run-output (FailureCard, mocha log, chat) is tied to the prior
            // (spec, grep) tuple — clicking a sibling `it` produces a
            // different grep, so showing the old failure under the new
            // selection is misleading. Treat node-change like spec-change.
            useStore.setState({
                ...stale,
                selectedSpec: "test/old.spec.js",
                selectedNode: { kind: "describe", fullTitle: "Login" },
            });

            useStore.getState().selectSuite(
                "test/old.spec.js",
                { kind: "it", fullTitle: "Login > works" },
            );

            const s = useStore.getState();
            expect(s.selectedSpec).toBe("test/old.spec.js");
            expect(s.selectedNode).toEqual({ kind: "it", fullTitle: "Login > works" });
            expect(s.mochaLog).toEqual([]);
            expect(s.mochaExitCode).toBeUndefined();
            expect(s.chatMessages).toEqual([]);
            expect(s.state.currentFailure).toBeUndefined();
            expect(s.pendingDiff).toBeNull();
        });

        it("is a no-op when the same spec and node are re-selected", () => {
            useStore.setState({
                ...stale,
                selectedSpec: "test/old.spec.js",
                selectedNode: { kind: "it", fullTitle: "Login > works" },
            });

            useStore.getState().selectSuite(
                "test/old.spec.js",
                { kind: "it", fullTitle: "Login > works" },
            );

            const s = useStore.getState();
            expect(s.mochaLog).toHaveLength(1);
            expect(s.state.currentFailure?.test).toBe("t");
            expect(s.chatMessages).toHaveLength(1);
        });

        it("clears when switching to null spec (no selection)", () => {
            useStore.setState({
                ...stale,
                selectedSpec: "test/old.spec.js",
                selectedNode: { kind: "it", fullTitle: "old > t" },
            });

            useStore.getState().selectSuite(null, null);

            const s = useStore.getState();
            expect(s.selectedSpec).toBeNull();
            expect(s.selectedNode).toBeNull();
            expect(s.mochaLog).toEqual([]);
            expect(s.state.currentFailure).toBeUndefined();
        });
    });
});
