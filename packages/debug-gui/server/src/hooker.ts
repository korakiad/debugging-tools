// v2 HTTP IPC state store.
//
// Previously a filesystem client (read .walkthrough/*.json, write .walkthrough/continue).
// Now an in-memory state holder. The debug-gui Express server mounts routes that
// mutate this state (POST /hook/status, /hook/paused, /hook/heartbeat, GET
// /hook/should-continue), and the Orchestrator polls getStatus/getPaused the
// same way it did with the filesystem impl — drop-in replacement.

export type HookState = "idle" | "running" | "paused" | "done";

export interface HookStatus {
    state: HookState;
    startedAt?: number;
    pausedAt?: number;
    resumedAt?: number;
    finishedAt?: number;
}

export interface HookFailure {
    test: string;
    file: string;
    error: string;
    stack: string;
    suite?: string;
    duration?: number;
    pausedAt?: number;
    // Retry metadata: which attempt this pause represents.
    // attempt=1 is the first run; attempt>1 means Mocha has already replayed
    // the test after a previous fix. maxAttempts reflects beforeEach's
    // this.retries(N)+1 ceiling so the UI can show "2/6" etc.
    attempt?: number;
    maxAttempts?: number;
}

export class HookerClient {
    private status: HookStatus = { state: "idle" };
    private paused: HookFailure | null = null;
    private continueFlag = false;
    private lastHeartbeatAt = 0;

    // Orchestrator-facing — matches v1 signature.
    async getStatus(): Promise<HookStatus> {
        return { ...this.status };
    }

    async getPaused(): Promise<HookFailure> {
        if (!this.paused) {
            const err = new Error("no paused failure");
            (err as any).code = "ENOENT";
            throw err;
        }
        return { ...this.paused };
    }

    async postContinue(): Promise<void> {
        this.continueFlag = true;
    }

    async reset(): Promise<void> {
        this.status = { state: "idle" };
        this.paused = null;
        this.continueFlag = false;
        this.lastHeartbeatAt = 0;
    }

    // Hook-facing — called by HTTP routes in server.ts.
    setStatus(patch: Partial<HookStatus> & { state: HookState }): void {
        this.status = { ...this.status, ...patch };
    }

    setPaused(failure: HookFailure): void {
        this.paused = { ...failure };
        this.status = { state: "paused", pausedAt: failure.pausedAt ?? Date.now() };
    }

    consumeContinue(): boolean {
        if (!this.continueFlag) return false;
        this.continueFlag = false;
        this.paused = null;
        return true;
    }

    recordHeartbeat(): void {
        this.lastHeartbeatAt = Date.now();
    }

    getLastHeartbeatAt(): number {
        return this.lastHeartbeatAt;
    }
}
