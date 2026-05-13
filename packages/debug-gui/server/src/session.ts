import { EventEmitter } from "events";
import { STATE, type FailureInfo, type SessionSnapshot, type SessionState } from "@debug-gui/protocol";

export type { FailureInfo, SessionSnapshot, SessionState };

export class SessionManager {
    readonly events = new EventEmitter();
    private snapshot: SessionSnapshot = { state: STATE.IDLE };

    getState(): SessionSnapshot {
        // Return a shallow clone so callers can't mutate our private snapshot.
        // The union's variants are flat; spreading is safe.
        return { ...this.snapshot } as SessionSnapshot;
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
        // PausedSnapshot requires currentSpec — paused can only follow
        // pre-running/running, which both carry currentSpec. Throw if a
        // caller violates that invariant (would mean a worker emitted
        // `paused` before any `markRunning`).
        const currentSpec = this.snapshot.currentSpec;
        if (!currentSpec) {
            throw new Error("SessionManager.markPaused called without an active spec");
        }
        this.snapshot = {
            state: STATE.PAUSED,
            currentSpec,
            currentFailure: failure,
            pausedAt: failure.pausedAt ?? Date.now(),
        };
        this.events.emit("change", this.getState());
    }

    markResumed(): void {
        // Resume from paused → running, preserving currentSpec; drops the
        // pause-only fields (currentFailure, pausedAt) so RunningSnapshot's
        // shape is satisfied.
        const currentSpec = this.snapshot.currentSpec;
        if (!currentSpec) {
            throw new Error("SessionManager.markResumed called without an active spec");
        }
        this.snapshot = { state: STATE.RUNNING, currentSpec };
        this.events.emit("change", this.getState());
    }

    markDone(): void {
        // DoneSnapshot accepts optional currentSpec; preserve whatever the
        // run had so the UI keeps "test/foo.spec.js — DONE" visible after
        // natural completion.
        this.snapshot = { state: STATE.DONE, currentSpec: this.snapshot.currentSpec };
        this.events.emit("change", this.getState());
    }

    reset(): void {
        this.snapshot = { state: STATE.IDLE };
        this.events.emit("change", this.getState());
    }
}
