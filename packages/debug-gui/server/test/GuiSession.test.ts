import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { GuiSession } from "../src/domain/GuiSession.js";
import { SessionManager } from "../src/session.js";
import { WorkerRun } from "../src/domain/WorkerRun.js";
import { AgentSession } from "../src/domain/AgentSession.js";

vi.mock("../src/domain/WorkerRun.js", () => ({
    WorkerRun: vi.fn().mockImplementation((opts: any) => ({
        opts,
        start: vi.fn().mockResolvedValue(undefined),
        stopGracefully: vi.fn().mockResolvedValue(undefined),
        onSessionChanged: vi.fn(),
    })),
}));
vi.mock("../src/domain/AgentSession.js", () => ({
    AgentSession: vi.fn().mockImplementation((opts: any) => ({
        opts,
        setup: vi.fn().mockResolvedValue(undefined),
        tearDown: vi.fn().mockResolvedValue(undefined),
        sendOnPause: vi.fn().mockResolvedValue(undefined),
        resolveEditDecision: vi.fn(),
        cancelPick: vi.fn().mockResolvedValue(undefined),
        resolvePromptResponse: vi.fn(),
    })),
}));

function manualPromise<T = void>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

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

function makeGuiWithStubs() {
    const runner = new EventEmitter() as any;
    const session = new SessionManager();
    const chrome = {
        kill: vi.fn().mockResolvedValue(undefined),
        launch: vi.fn().mockResolvedValue({ debuggerAddress: "localhost:9222", port: 9222 }),
        getHandle: vi.fn().mockReturnValue({ port: 9222 }),
    } as any;
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
    return { gui, runner, session, chrome, broadcast, hub };
}

describe("GuiSession FSM (start/stop/continue transitions)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("drops start() while a stop() is still in-flight", async () => {
        const { gui, chrome } = makeGuiWithStubs();
        const tearDownGate = manualPromise<void>();
        // Slow tearDown on the first AgentSession — that's the one stop()
        // will await, so the window between state="stopping" and idle
        // stays open across the racing start().
        vi.mocked(AgentSession).mockImplementationOnce((_opts: any) => ({
            setup: vi.fn().mockResolvedValue(undefined),
            tearDown: vi.fn().mockReturnValue(tearDownGate.promise),
            sendOnPause: vi.fn().mockResolvedValue(undefined),
            resolveEditDecision: vi.fn(),
            cancelPick: vi.fn().mockResolvedValue(undefined),
            resolvePromptResponse: vi.fn(),
        }) as any);

        await gui.start({ specRel: "a.spec.js" } as any, false);
        expect((gui as any).state).toBe("running");

        const stopPromise = gui.stop();
        await Promise.resolve();
        expect((gui as any).state).toBe("stopping");

        const chromeLaunchCallsBefore = chrome.launch.mock.calls.length;
        await gui.start({ specRel: "b.spec.js" } as any, false);

        expect(chrome.launch.mock.calls.length).toBe(chromeLaunchCallsBefore);
        expect((gui as any).state).toBe("stopping");

        tearDownGate.resolve();
        await stopPromise;
        expect((gui as any).state).toBe("idle");
    });

    it("resets to idle when continueSession's chrome.launch throws mid-swap", async () => {
        const { gui, chrome, session, broadcast } = makeGuiWithStubs();

        await gui.start({ specRel: "a.spec.js" } as any, false);
        session.markRunning("a.spec.js");
        session.markPaused({ test: "t", file: "a.spec.js", error: "x", stack: "" });

        chrome.launch.mockRejectedValueOnce(new Error("chrome boom"));

        await gui.continueSession();

        expect((gui as any).state).toBe("idle");
        expect((gui as any).run).toBeNull();
        expect((gui as any).agent).toBeNull();
        expect(session.getState().state).toBe("idle");
        const errs = broadcast.mock.calls.filter(([e]: any[]) => e?.type === "error");
        expect(errs.length).toBeGreaterThanOrEqual(1);
        expect(errs[0][0].message).toMatch(/Continue failed/i);
    });

    it("start() forks worker + agent and marks state running", async () => {
        const { gui, chrome } = makeGuiWithStubs();

        await gui.start({ specRel: "a.spec.js" } as any, false);

        expect(chrome.kill).toHaveBeenCalledTimes(1);
        expect(chrome.launch).toHaveBeenCalledTimes(1);
        expect(vi.mocked(WorkerRun)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(AgentSession)).toHaveBeenCalledTimes(1);
        expect((gui as any).state).toBe("running");
    });

    it("stop() while running tears agent + worker + chrome and resets", async () => {
        const { gui, chrome, session } = makeGuiWithStubs();
        await gui.start({ specRel: "a.spec.js" } as any, false);
        session.markRunning("a.spec.js");

        await gui.stop();

        expect(chrome.kill).toHaveBeenCalledTimes(2);
        expect((gui as any).agent).toBeNull();
        expect((gui as any).run).toBeNull();
        expect(session.getState().state).toBe("idle");
        expect((gui as any).state).toBe("idle");
        expect((gui as any).lastOpts).toBeNull();
    });

    it("continueSession() swaps worker without killing chrome", async () => {
        const { gui, chrome, session } = makeGuiWithStubs();
        await gui.start({ specRel: "a.spec.js" } as any, false);
        session.markRunning("a.spec.js");
        session.markPaused({ test: "t", file: "a.spec.js", error: "x", stack: "" });

        await gui.continueSession();

        expect(chrome.kill).toHaveBeenCalledTimes(1);
        expect(chrome.launch).toHaveBeenCalledTimes(2);
        expect(vi.mocked(WorkerRun)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(AgentSession)).toHaveBeenCalledTimes(2);
        expect((gui as any).state).toBe("running");
        expect((gui as any).lastOpts).toEqual({ specRel: "a.spec.js" });
    });
});
