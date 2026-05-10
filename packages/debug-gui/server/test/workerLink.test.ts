import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { WorkerLink } from "../src/workerLink.js";
import { SessionManager } from "../src/session.js";

// Minimal ChildProcess fake — EventEmitter for on('message')/on('exit'),
// plus a stubbed `send` and a writable `connected` flag. WorkerLink only
// touches these surface bits.
function makeFakeChild() {
    const child: any = new EventEmitter();
    child.connected = true;
    child.send = vi.fn().mockReturnValue(true);
    return child;
}

describe("WorkerLink", () => {
    it("forwards a paused frame into session.markPaused", () => {
        const session = new SessionManager();
        session.markRunning("a.spec.js");
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        link.attach(child);

        child.emit("message", {
            type: "paused",
            failure: {
                test: "t1",
                file: "a.spec.js",
                error: "boom",
                stack: "stack-here",
            },
        });

        expect(session.getState().state).toBe("paused");
        expect(session.getState().currentFailure?.error).toBe("boom");
    });

    it("flips back to running on a status:running frame, preserving currentSpec", () => {
        const session = new SessionManager();
        session.markRunning("a.spec.js");
        session.markPaused({
            test: "t1",
            file: "a.spec.js",
            error: "boom",
            stack: "",
        });
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        link.attach(child);

        child.emit("message", { type: "status", state: "running", resumedAt: 42 });

        expect(session.getState().state).toBe("running");
        expect(session.getState().currentSpec).toBe("a.spec.js");
    });

    it("marks session done on a status:done frame", () => {
        const session = new SessionManager();
        session.markRunning("a.spec.js");
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        link.attach(child);

        child.emit("message", { type: "status", state: "done", finishedAt: 99 });

        expect(session.getState().state).toBe("done");
    });

    it("sendResume forwards {type:'resume'} via child.send", () => {
        const session = new SessionManager();
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        link.attach(child);

        const ok = link.sendResume();

        expect(ok).toBe(true);
        expect(child.send).toHaveBeenCalledWith({ type: "resume" });
    });

    it("sendStop forwards {type:'stop'} via child.send", () => {
        const session = new SessionManager();
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        link.attach(child);

        const ok = link.sendStop();

        expect(ok).toBe(true);
        expect(child.send).toHaveBeenCalledWith({ type: "stop" });
    });

    it("send returns false when child has disconnected", () => {
        const session = new SessionManager();
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        link.attach(child);

        child.connected = false;
        const ok = link.sendResume();

        expect(ok).toBe(false);
        expect(child.send).not.toHaveBeenCalled();
    });

    it("on exit while running, session transitions to done", () => {
        const session = new SessionManager();
        session.markRunning("a.spec.js");
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        link.attach(child);

        child.emit("exit", 0);

        expect(session.getState().state).toBe("done");
    });

    it("on exit while paused, session stays paused — cancel handler owns the transition", () => {
        // Mirrors the existing runner.exit handler in index.ts: leaving the
        // paused snapshot in place lets the Stop click drive the explicit
        // session.reset() without a competing markDone() race.
        const session = new SessionManager();
        session.markRunning("a.spec.js");
        session.markPaused({
            test: "t1",
            file: "a.spec.js",
            error: "boom",
            stack: "",
        });
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        link.attach(child);

        child.emit("exit", 1);

        expect(session.getState().state).toBe("paused");
    });

    it("after exit, send returns false even if a stale child reference would be writable", () => {
        const session = new SessionManager();
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        link.attach(child);

        child.emit("exit", 0);
        const ok = link.sendResume();

        expect(ok).toBe(false);
    });

    it("swallows child.send throws and returns false", () => {
        const session = new SessionManager();
        const link = new WorkerLink(session);
        const child = makeFakeChild();
        child.send = vi.fn().mockImplementation(() => {
            throw new Error("EPIPE");
        });
        link.attach(child);

        const ok = link.sendResume();

        expect(ok).toBe(false);
    });
});
