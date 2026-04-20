import { SessionManager } from "./session.js";
import { HookerClient } from "./hooker.js";

export class Orchestrator {
    private timer?: NodeJS.Timeout;
    constructor(
        private session: SessionManager,
        private hooker: HookerClient
    ) {}

    async pollOnce(): Promise<void> {
        const status = await this.hooker.getStatus();
        const current = this.session.getState().state;
        if (status.state === "paused" && current !== "paused") {
            const failure = await this.hooker.getPaused();
            this.session.markPaused(failure);
        } else if (status.state === "running" && current === "paused") {
            // Hook consumed a continue signal out-of-band (e.g. agent via shell)
            this.session.markResumed();
        } else if (status.state === "done" && current !== "done") {
            this.session.markDone();
        }
    }

    start(intervalMs = 500): void {
        this.timer = setInterval(() => this.pollOnce().catch(() => {}), intervalMs);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
    }
}
