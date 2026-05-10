import { ChildProcess } from "child_process";
import { SessionManager } from "./session.js";
import type { WorkerOutbound, WorkerInbound } from "./workerProtocol.js";

// Push-driven adapter for the worker IPC channel. The forked mocha worker
// pushes status/paused/done frames over the Node IPC channel; WorkerLink
// translates them into SessionManager state transitions. Outbound
// resume/stop frames go back the same channel.
export class WorkerLink {
    private child?: ChildProcess;

    constructor(private readonly session: SessionManager) {}

    attach(child: ChildProcess): void {
        this.child = child;
        child.on("message", (m: unknown) => this.handle(m as WorkerOutbound));
        child.on("exit", () => {
            this.child = undefined;
            // Mirror the pre-IPC runner.exit handler: only flip to "done" if
            // we weren't already paused — leaving the paused snapshot in
            // place lets the cancel/stop handler own the transition.
            if (this.session.getState().state !== "paused") {
                this.session.markDone();
            }
        });
    }

    private handle(m: WorkerOutbound): void {
        if (!m || typeof m !== "object") return;
        if (m.type === "paused") {
            this.session.markPaused(m.failure);
            return;
        }
        if (m.type === "status" && m.state === "running") {
            this.session.markRunning(this.session.getState().currentSpec ?? "");
            return;
        }
        if (m.type === "status" && m.state === "done") {
            this.session.markDone();
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
