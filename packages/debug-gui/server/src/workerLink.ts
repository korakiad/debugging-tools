import { ChildProcess } from "child_process";
import { STATE, assertNever, type WorkerOutbound, type WorkerInbound } from "@debug-gui/protocol";
import { SessionManager } from "./session.js";

// Push-driven adapter for the worker IPC channel. The forked mocha worker
// pushes status/paused/done frames over the Node IPC channel; WorkerLink
// translates them into SessionManager state transitions. Outbound
// resume/stop frames go back the same channel.
export class WorkerLink {
    private child?: ChildProcess;

    constructor(private readonly session: SessionManager) {}

    attach(child: ChildProcess): void {
        this.child = child;
        child.on("message", (m: unknown) => {
            if (!m || typeof m !== "object" || !("type" in m)) return;
            this.handle(m as WorkerOutbound);
        });
        child.on("exit", () => {
            this.child = undefined;
            // Mirror the pre-IPC runner.exit handler: only flip to "done" if
            // we weren't already paused — leaving the paused snapshot in
            // place lets the cancel/stop handler own the transition.
            if (this.session.getState().state !== STATE.PAUSED) {
                this.session.markDone();
            }
        });
    }

    private handle(m: WorkerOutbound): void {
        switch (m.type) {
            case "paused":
                this.session.markPaused(m.failure);
                return;
            case "status":
                if (m.state === STATE.RUNNING) {
                    this.session.markRunning(this.session.getState().currentSpec ?? "");
                } else if (m.state === STATE.DONE) {
                    this.session.markDone();
                }
                return;
            case "done":
                // The worker emits this from mocha.run's callback before
                // exit. The session.markDone for the natural-completion
                // case is owned by the runner.exit handler in index.ts;
                // this frame is informational only here.
                return;
            default:
                return assertNever(m, "WorkerLink.handle");
        }
    }

    send(msg: WorkerInbound): boolean {
        if (!this.child || !this.child.connected) return false;
        try {
            return this.child.send(msg);
        } catch {
            return false;
        }
    }

    sendResume(): boolean {
        return this.send({ type: "resume" });
    }

    sendStop(): boolean {
        return this.send({ type: "stop" });
    }

    detach(): void {
        this.child = undefined;
    }
}
