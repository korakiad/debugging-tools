import { EventEmitter } from "events";
import { STATE, type FailureInfo, type SessionSnapshot, type SessionState } from "@debug-gui/protocol";

export type { FailureInfo, SessionSnapshot, SessionState };

export class SessionManager {
    readonly events = new EventEmitter();
    private snapshot: SessionSnapshot = { state: STATE.IDLE };

    getState(): SessionSnapshot {
        return { ...this.snapshot };
    }

    markPreRunning(spec: string): void {
        this.snapshot = { state: STATE.PRE_RUNNING, currentSpec: spec };
        this.events.emit("change", this.getState());
    }

    markRunning(spec: string): void {
        this.snapshot = { state: STATE.RUNNING, currentSpec: spec };
        this.events.emit("change", this.getState());
    }

    markPaused(failure: FailureInfo): void {
        this.snapshot = { ...this.snapshot, state: STATE.PAUSED, currentFailure: failure };
        this.events.emit("change", this.getState());
    }

    markResumed(): void {
        this.snapshot = { ...this.snapshot, state: STATE.RUNNING, currentFailure: undefined };
        this.events.emit("change", this.getState());
    }

    markDone(): void {
        this.snapshot = { state: STATE.DONE, currentSpec: this.snapshot.currentSpec };
        this.events.emit("change", this.getState());
    }

    reset(): void {
        this.snapshot = { state: STATE.IDLE };
        this.events.emit("change", this.getState());
    }
}
