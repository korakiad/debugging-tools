import { describe, it, expect } from "vitest";
import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";

// Smoke test: confirm the @pierre/diffs/react entry resolves through the
// vitest worker-URL alias and exposes the symbols main.tsx imports. No render
// here — Pierre's WorkerPoolManager constructs an async worker on mount which
// jsdom can't service, and we catch real render failures via the Task 6
// browser smoke. This test exists to catch alias / package-version regressions.
describe("@pierre/diffs/react entry resolves", () => {
    it("exposes WorkerPoolContextProvider and useWorkerPool", () => {
        expect(typeof WorkerPoolContextProvider).toBe("function");
        expect(typeof useWorkerPool).toBe("function");
    });
});
