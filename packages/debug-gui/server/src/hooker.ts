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

    // Wipe stale signal files before a fresh run. Without this, the
    // orchestrator's first poll (500ms after runner.start) reads last
    // session's paused.json and fires a bogus markPaused while mocha
    // is still booting — which triggers a second, concurrent agent
    // sendAndWait when the real failure finally writes a new paused.json.
    async reset(): Promise<void> {
        try {
            await fs.rm(this.signalDir, { recursive: true, force: true });
        } catch {
            // ignore — dir may not exist
        }
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
