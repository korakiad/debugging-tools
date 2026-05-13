import type { FailureInfo } from "./failure.js";
import type { STATE } from "./state.js";

// Worker → Server frames sent over the Node IPC channel by mocha-ipc-hooks.cjs.
// The cjs hook emits string literals for `state`; consumers should validate via
// guards.parseWorkerFrame() before trusting the shape.
export type WorkerOutbound =
    | {
          type: "status";
          state: typeof STATE.RUNNING | typeof STATE.DONE;
          startedAt?: number;
          resumedAt?: number;
          finishedAt?: number;
      }
    | { type: "paused"; failure: FailureInfo }
    | { type: "done"; failures: number };

// Server → Worker frames.
export type WorkerInbound =
    | { type: "resume" }
    | { type: "stop" };
