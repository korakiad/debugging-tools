import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

describe("store", () => {
    beforeEach(() => {
        useStore.setState({
            suites: [],
            config: {},
            state: { state: "idle" },
            chatMessages: [],
            pendingDiff: null,
            pendingPick: null,
        });
    });

    it("initializes with idle state", () => {
        const s = useStore.getState();
        expect(s.state.state).toBe("idle");
    });

    it("apply 'init' event populates suites + config", () => {
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
});
