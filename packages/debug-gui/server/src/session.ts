import { EventEmitter } from "events";

export type SessionState = "idle" | "running" | "paused" | "done";

export interface FailureInfo {
    test: string;
    file: string;
    error: string;
    stack: string;
    suite?: string;
    pausedAt?: number;
}

export interface SessionSnapshot {
    state: SessionState;
    currentSpec?: string;
    currentFailure?: FailureInfo;
}

export class SessionManager {
    readonly events = new EventEmitter();
    private snapshot: SessionSnapshot = { state: "idle" };

    getState(): SessionSnapshot {
        return { ...this.snapshot };
    }

    markRunning(spec: string): void {
        this.snapshot = { state: "running", currentSpec: spec };
        this.events.emit("change", this.getState());
    }

    markPaused(failure: FailureInfo): void {
        this.snapshot = { ...this.snapshot, state: "paused", currentFailure: failure };
        this.events.emit("change", this.getState());
    }

    markResumed(): void {
        this.snapshot = { ...this.snapshot, state: "running", currentFailure: undefined };
        this.events.emit("change", this.getState());
    }

    markDone(): void {
        this.snapshot = { state: "done", currentSpec: this.snapshot.currentSpec };
        this.events.emit("change", this.getState());
    }

    reset(): void {
        this.snapshot = { state: "idle" };
        this.events.emit("change", this.getState());
    }
}
