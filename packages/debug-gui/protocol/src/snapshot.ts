import { STATE } from "./state.js";
import type { FailureInfo } from "./failure.js";

// Discriminated union. The meaningful invariant we enforce at the type
// level is "paused requires currentFailure + pausedAt + currentSpec" —
// that's the variant where consumers actually access those fields without
// a guard. PreRunning/Running keep currentSpec optional because the web
// reducer derives state.currentSpec by mirroring server broadcasts whose
// payload doesn't include the spec; a strict requirement would push that
// invariant onto every transition site for no observable safety gain.
// Idle/Done permit an optional currentSpec (last-known spec preserved
// across natural finish for breadcrumb display).
export interface IdleSnapshot {
    state: typeof STATE.IDLE;
    currentSpec?: string;
}
export interface PreRunningSnapshot {
    state: typeof STATE.PRE_RUNNING;
    currentSpec?: string;
}
export interface RunningSnapshot {
    state: typeof STATE.RUNNING;
    currentSpec?: string;
}
export interface PausedSnapshot {
    state: typeof STATE.PAUSED;
    currentSpec: string;
    currentFailure: FailureInfo;
    // Wall-clock ms stamped by the server when the runner reported pause.
    // The web reducer also stamps on receipt of `paused` for defence in
    // depth against older workers that omit it.
    pausedAt: number;
}
export interface DoneSnapshot {
    state: typeof STATE.DONE;
    currentSpec?: string;
}

export type SessionSnapshot =
    | IdleSnapshot
    | PreRunningSnapshot
    | RunningSnapshot
    | PausedSnapshot
    | DoneSnapshot;
