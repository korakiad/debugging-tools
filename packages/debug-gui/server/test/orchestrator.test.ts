import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { SessionManager } from "../src/session.js";

describe("Orchestrator", () => {
    it("transitions session to paused when hooker reports paused", async () => {
        const session = new SessionManager();
        const hooker = {
            getStatus: vi.fn().mockResolvedValue({ state: "paused" }),
            getPaused: vi.fn().mockResolvedValue({
                test: "t1", file: "a.spec.js", error: "e", stack: "",
            }),
            postContinue: vi.fn(),
        };
        const orch = new Orchestrator(session, hooker as any);
        session.markRunning("a.spec.js");
        await orch.pollOnce();
        expect(session.getState().state).toBe("paused");
        expect(session.getState().currentFailure?.test).toBe("t1");
    });

    it("transitions to done when hooker reports done", async () => {
        const session = new SessionManager();
        session.markRunning("a.spec.js");
        const hooker = { getStatus: vi.fn().mockResolvedValue({ state: "done" }) } as any;
        const orch = new Orchestrator(session, hooker);
        await orch.pollOnce();
        expect(session.getState().state).toBe("done");
    });

    it("does not re-mark session paused if hooker was reset between getStatus and getPaused", async () => {
        // Race scenario: a Stop click fires session.reset() while a
        // pollOnce is mid-flight. The poll already read getStatus()=paused
        // before the cancel ran, then sees session.state=idle after the
        // reset. Without protection, it would call getPaused() and
        // markPaused(), flipping the snapshot back to paused — exactly
        // the QA-reported "Stop while paused doesn't clear" bug.
        // index.ts's cancel handler resets the hooker before the session,
        // so a real getPaused() throws here; we verify the orchestrator
        // tolerates that and leaves the session alone.
        const session = new SessionManager();
        session.markRunning("a.spec.js");
        const hooker = {
            getStatus: vi.fn().mockResolvedValue({ state: "paused" }),
            getPaused: vi.fn().mockRejectedValue(
                Object.assign(new Error("no paused failure"), { code: "ENOENT" }),
            ),
        } as any;
        const orch = new Orchestrator(session, hooker);
        // Simulate the cancel-handler ordering: session reset before the
        // in-flight pollOnce gets to look at it.
        session.reset();
        await orch.pollOnce().catch(() => {});
        // Session must stay idle, not flip back to paused.
        expect(session.getState().state).toBe("idle");
        expect(session.getState().currentFailure).toBeUndefined();
    });
});
