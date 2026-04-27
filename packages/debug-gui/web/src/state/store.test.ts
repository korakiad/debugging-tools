import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

describe("store", () => {
    beforeEach(() => {
        useStore.setState({
            suites: [],
            config: {},
            state: { state: "idle" },
            selectedSpec: null,
            chatMessages: [],
            pendingDiff: null,
            pendingPick: null,
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

    it("suites_updated clears selectedSpec when it is no longer in the new suites", () => {
        useStore.setState({
            suites: [{ relPath: "test/login.spec.js", absPath: "/x/test/login.spec.js" }],
            selectedSpec: "test/login.spec.js",
        });
        useStore.getState().applyEvent({
            type: "suites_updated",
            suites: [],
        });
        expect(useStore.getState().selectedSpec).toBeNull();
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
});
