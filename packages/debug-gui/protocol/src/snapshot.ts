import type { SessionState } from "./state.js";
import type { FailureInfo } from "./failure.js";

// Flat shape carrying optional fields. Phase 1 narrows this into a
// discriminated union so paused-only fields become required-when-paused.
// Kept flat in Phase 0 so the migration is a pure import-swap.
export interface SessionSnapshot {
    state: SessionState;
    currentSpec?: string;
    currentFailure?: FailureInfo;
    // Web-only timestamp (server's SessionManager doesn't set this in
    // Phase 0; the web reducer overrides on receipt of `paused`). Phase 1
    // promotes this to a required field of the paused variant.
    pausedAt?: number;
}
