import type { FailureInfo } from "./session.js";

// Worker → Server.
// `paused.failure` carries FailureInfo plus extra runtime fields the UI reads
// off currentFailure (`attempt`, `maxAttempts`, `duration`). FailureInfo
// stays the canonical TS type — extras flow through opaquely.
export type WorkerOutbound =
    | {
          type: "status";
          state: "running" | "done";
          startedAt?: number;
          resumedAt?: number;
          finishedAt?: number;
      }
    | { type: "paused"; failure: FailureInfo }
    | { type: "done"; failures: number };

// Server → Worker.
export type WorkerInbound =
    | { type: "resume" }
    | { type: "stop" };
