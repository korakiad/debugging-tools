import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import { GuiSession } from "../src/domain/GuiSession.js";
import { SessionManager } from "../src/session.js";

// Minimal stubs. We exercise only the runner-exit listener installed in
// the GuiSession constructor — not start()/stop()/continue() — so the
// browser, copilot, and pre-run paths never run.
function makeGui(initialState?: "running" | "stopping" | "swapping" | "pre-running") {
    const runner = new EventEmitter() as any;
    const session = new SessionManager();
    const chrome = { kill: vi.fn(), launch: vi.fn(), getHandle: () => null } as any;
    const copilot = {} as any;
    const broadcast = vi.fn();
    const hub = { broadcast, onMessage: vi.fn() } as any;
    const gui = new GuiSession({
        cwd: "/tmp",
        session,
        runner,
        chrome,
        copilot,
        hub,
        config: () => ({
            mocha: {},
            cdp: { port: 9222 },
            discovery: { globs: [], exclude: [] },
            agent: { idleTimeoutMs: 0, mode: "manual" },
        }),
        pickScriptPath: "/tmp/pick.js",
    });
    if (initialState) (gui as any).state = initialState;
    return { gui, runner, session, broadcast };
}

describe("GuiSession FSM (exit listener)", () => {
    it("returns to 'idle' on natural worker exit so the next Start is accepted", () => {
        const { gui, runner, session } = makeGui("running");
        session.markRunning("login.spec.js");

        runner.emit("exit", 0);

        expect((gui as any).state).toBe("idle");
        expect((gui as any).run).toBeNull();
        expect(session.getState().state).toBe("done");
    });

    it("does not overwrite the 'stopping' transition that stop() owns", () => {
        const { gui, runner, session } = makeGui("stopping");
        session.markRunning("login.spec.js");

        runner.emit("exit", null);

        // stop()'s finally is the authoritative path; the exit listener
        // must not race ahead and flip to 'idle' early.
        expect((gui as any).state).toBe("stopping");
    });

    it("early-returns during a Continue swap (no mocha_exit broadcast, no markDone)", () => {
        const { gui, runner, session, broadcast } = makeGui("swapping");
        session.markRunning("login.spec.js");

        runner.emit("exit", 0);

        expect((gui as any).state).toBe("swapping");
        expect(session.getState().state).toBe("running");
        const exitEvents = broadcast.mock.calls.filter(([e]) => e?.type === "mocha_exit");
        expect(exitEvents).toHaveLength(0);
    });

    it("keeps the paused wire state when the worker exits while paused", () => {
        // Worker exits while wire state is paused (e.g. afterEach throws
        // after Stop). The listener must skip markDone to avoid
        // clobbering the failure snapshot before stop() runs.
        const { gui, runner, session } = makeGui("running");
        session.markRunning("login.spec.js");
        session.markPaused({
            test: "t",
            file: "login.spec.js",
            error: "boom",
            stack: "",
        });

        runner.emit("exit", 1);

        expect(session.getState().state).toBe("paused");
        // FSM still resets — the next Run is accepted regardless of how
        // the worker died.
        expect((gui as any).state).toBe("idle");
    });
});
