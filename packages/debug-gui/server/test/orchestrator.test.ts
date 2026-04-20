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
});
