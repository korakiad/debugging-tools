import { describe, it, expect, vi } from "vitest";
import { SessionManager } from "../src/session.js";

describe("SessionManager", () => {
    it("starts in idle state", () => {
        const s = new SessionManager();
        expect(s.getState().state).toBe("idle");
    });

    it("transitions idle → running on start", () => {
        const s = new SessionManager();
        s.markRunning("login.spec.js");
        expect(s.getState().state).toBe("running");
        expect(s.getState().currentSpec).toBe("login.spec.js");
    });

    it("transitions running → paused with failure", () => {
        const s = new SessionManager();
        s.markRunning("login.spec.js");
        s.markPaused({ test: "t1", file: "login.spec.js", error: "err", stack: "" });
        expect(s.getState().state).toBe("paused");
        expect(s.getState().currentFailure?.error).toBe("err");
    });

    it("emits 'change' event on transitions", () => {
        const s = new SessionManager();
        const listener = vi.fn();
        s.events.on("change", listener);
        s.markRunning("a.spec.js");
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("markPreRunning transitions idle → pre-running with the spec", () => {
        const s = new SessionManager();
        s.markPreRunning("a.spec.js");
        expect(s.getState()).toEqual({ state: "pre-running", currentSpec: "a.spec.js" });
    });

    it("markRunning after markPreRunning keeps currentSpec", () => {
        const s = new SessionManager();
        s.markPreRunning("a.spec.js");
        s.markRunning("a.spec.js");
        expect(s.getState().state).toBe("running");
        expect(s.getState().currentSpec).toBe("a.spec.js");
    });
});
