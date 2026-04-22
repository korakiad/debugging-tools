import { describe, it, expect } from "vitest";
import { HookerClient } from "../src/hooker.js";

describe("HookerClient (in-memory v2)", () => {
    it("starts idle", async () => {
        const h = new HookerClient();
        expect(await h.getStatus()).toEqual({ state: "idle" });
    });

    it("setStatus updates what getStatus returns", async () => {
        const h = new HookerClient();
        h.setStatus({ state: "running", startedAt: 1 });
        expect(await h.getStatus()).toEqual({ state: "running", startedAt: 1 });
    });

    it("setPaused transitions to paused and stores failure", async () => {
        const h = new HookerClient();
        h.setPaused({ test: "t", file: "a.spec.js", error: "e", stack: "", pausedAt: 42 });
        const status = await h.getStatus();
        expect(status.state).toBe("paused");
        expect(status.pausedAt).toBe(42);
        const failure = await h.getPaused();
        expect(failure.test).toBe("t");
        expect(failure.error).toBe("e");
    });

    it("getPaused throws ENOENT-style error when nothing is paused", async () => {
        const h = new HookerClient();
        await expect(h.getPaused()).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("postContinue + consumeContinue — flag flips once then resets", async () => {
        const h = new HookerClient();
        h.setPaused({ test: "t", file: "a", error: "e", stack: "" });
        await h.postContinue();
        expect(h.consumeContinue()).toBe(true);
        // Second consume returns false — hook polled after resume shouldn't re-fire.
        expect(h.consumeContinue()).toBe(false);
    });

    it("consumeContinue clears the paused failure so getPaused throws again", async () => {
        const h = new HookerClient();
        h.setPaused({ test: "t", file: "a", error: "e", stack: "" });
        await h.postContinue();
        h.consumeContinue();
        await expect(h.getPaused()).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("reset clears state back to idle", async () => {
        const h = new HookerClient();
        h.setPaused({ test: "t", file: "a", error: "e", stack: "" });
        await h.postContinue();
        await h.reset();
        expect(await h.getStatus()).toEqual({ state: "idle" });
        await expect(h.getPaused()).rejects.toMatchObject({ code: "ENOENT" });
        expect(h.consumeContinue()).toBe(false);
    });

    it("recordHeartbeat updates lastHeartbeatAt", async () => {
        const h = new HookerClient();
        expect(h.getLastHeartbeatAt()).toBe(0);
        const before = Date.now();
        h.recordHeartbeat();
        expect(h.getLastHeartbeatAt()).toBeGreaterThanOrEqual(before);
    });
});
