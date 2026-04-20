import { promises as fs } from "fs";
import path from "path";

// Matches .claude/skills/walkthrough/walkthrough-hooks.js (v1 filesystem protocol).
// When the repo lands the v2 HTTP hooker (port 3456), swap this out for a
// fetch-based implementation — orchestrator only touches getStatus/getPaused/postContinue.
export class HookerClient {
    private signalDir: string;
    constructor(cwd: string) {
        this.signalDir = path.join(cwd, ".walkthrough");
    }

    async getStatus(): Promise<{
        state: "idle" | "running" | "paused" | "done";
        startedAt?: number;
        pausedAt?: number;
        finishedAt?: number;
    }> {
        return this.readJson("status.json", { state: "idle" });
    }

    async getPaused(): Promise<{
        test: string;
        file: string;
        error: string;
        stack: string;
        suite?: string;
    }> {
        return this.readJson("paused.json");
    }

    async postContinue(): Promise<void> {
        await fs.mkdir(this.signalDir, { recursive: true });
        const file = path.join(this.signalDir, "continue");
        await fs.writeFile(file, "");
        // Wait up to 2s for the hook's polling loop to consume the signal —
        // otherwise the orchestrator can re-read stale paused.json and flash
        // the UI back to paused before the hook has cleaned up.
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 100));
            try {
                await fs.access(file);
            } catch {
                return;
            }
        }
    }

    private async readJson<T>(name: string, fallback?: T): Promise<T> {
        try {
            const raw = await fs.readFile(path.join(this.signalDir, name), "utf8");
            return JSON.parse(raw);
        } catch (e: any) {
            if (fallback !== undefined && e?.code === "ENOENT") return fallback;
            throw e;
        }
    }
}
